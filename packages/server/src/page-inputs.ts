/** Only compiler-proved primitive leaves cross the page binding boundary. */
export function encodePageInputs(inputs:readonly unknown[]):{inputs:readonly unknown[];missing?:readonly (readonly (string|number)[])[]} {
  const missing:(string|number)[][]=[];
  const encode=(value:unknown,path:(string|number)[]):unknown=>{
    if(value===undefined){missing.push(path);return null;}
    if(Array.isArray(value))return value.map((item,index)=>encode(item,[...path,index]));
    if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item,[...path,key])]));
    return value;
  };
  const encoded=encode(inputs,[]) as readonly unknown[];
  return {inputs:encoded,...(missing.length?{missing}:{})};
}

export function projectPageInputs(inputs: readonly unknown[], paths: readonly (readonly (string | number)[])[]): readonly unknown[] {
  interface Selection { leaf?: true; children: Map<string, Selection> }
  function merge(left: Selection | undefined, right: Selection): Selection {
    if (!left) return right;
    const children = new Map(left.children);
    for (const [key,child] of right.children) children.set(key,merge(children.get(key),child));
    return { ...(left.leaf || right.leaf ? {leaf:true} : {}), children };
  }
  const selection: Selection = {children:new Map()};
  for (const path of paths) {
    let node = selection;
    for (const part of path) {
      const key = String(part);
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new TypeError('memo-dom: unsafe page input path');
      let child = node.children.get(key);
      if (!child) node.children.set(key,child={children:new Map()});
      node = child;
    }
    node.leaf = true;
  }
  function project(value: unknown, node: Selection): unknown {
    if (value === null || value === undefined) return value;
    if (node.leaf) {
      if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        throw new TypeError('memo-dom: page bindings require explicit serializable fields, not whole objects or server closures');
      }
      if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('memo-dom: non-finite page binding input');
      return value;
    }
    if (typeof value !== 'object') throw new TypeError('memo-dom: page binding input shape does not match its compiled projection');
    if (Array.isArray(value)) {
      const output = new Array(value.length).fill(null);
      const row = node.children.get('*');
      const specific = new Map<number, Selection>();
      for (const [key,child] of node.children) if (key !== '*' && key !== 'length') {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= value.length) throw new TypeError('memo-dom: invalid page array projection');
        specific.set(index,merge(specific.get(index),child));
      }
      for (let index=0; index<value.length; index++) {
        const child = specific.get(index);
        const fields = child ? merge(row,child) : row;
        if (fields) output[index] = project(value[index],fields);
      }
      return output;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('memo-dom: services and class instances cannot be page binding inputs');
    const output: Record<string, unknown> = Object.create(null);
    for (const [key,child] of node.children) {
      const descriptor = Object.getOwnPropertyDescriptor(value,key);
      if (descriptor && !('value' in descriptor)) throw new TypeError('memo-dom: page inputs cannot invoke getters');
      output[String(key)]=project(descriptor?.value,child);
    }
    return output;
  }
  return project(inputs,selection) as readonly unknown[];
}
