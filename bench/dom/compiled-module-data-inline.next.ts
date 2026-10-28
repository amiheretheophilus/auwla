/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
const _renderProgram = { mount(_values, _owner) {
  const _document = _MD.getActiveEnvironment().document;
  const _valueId = _owner.id;
  const _valueEntity = _owner.entity;
  const _valueWrites = _owner.batch;
  const _namespace = _owner.namespace;
  const _clone = _MD.cloneTemplate(_template, _namespace);
  const _text = _clone.firstChild;
  const _node = _text.nextSibling;
  const _text2 = _node.nextSibling;
  let _value = _values[1];
  if (_value != null && _value !== false) {
    _clone.setAttribute("class", _value === true ? "" : _MD.textValue(_value));
  } else {
    _clone.removeAttribute("class");
  }
  let _value2 = _values[2];
  let _listener;
  if (_listener !== undefined) _clone.removeEventListener("click", _listener);
  _listener = undefined;
  if (typeof _value2 === "function") {
    _listener = _valueWrites === null ? _value2 : _valueWrites.listener(_value2);
    _clone.addEventListener("click", _listener);
  }
  let _value3 = _values[3];
  let _valueSlot = null;
  if (_valueSlot === null && (_value3 === null || typeof _value3 !== "object")) {
    _MD.setTextData(_text, _value3);
  } else {
    (_valueSlot ??= _MD.createIndexedValueSlot(_text, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_value3);
  }
  let _value4 = _values[4];
  let _valueSlot2 = null;
  if (_valueSlot2 === null && (_value4 === null || typeof _value4 !== "object")) {
    _MD.setTextData(_text2, _value4);
  } else {
    (_valueSlot2 ??= _MD.createIndexedValueSlot(_text2, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_value4);
  }
  return { nodes: [_clone], update(_values2) {
    _values = _values2;
    const _next = _values[1];
    if (_next !== _value && !(_next !== _next && _value !== _value)) {
      if (_next != null && _next !== false) {
        _clone.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
      } else {
        _clone.removeAttribute("class");
      }
      _value = _next;
    }
    const _next2 = _values[2];
    if (_next2 !== _value2 && !(_next2 !== _next2 && _value2 !== _value2)) {
      if (_listener !== undefined) _clone.removeEventListener("click", _listener);
      _listener = undefined;
      if (typeof _next2 === "function") {
        _listener = _valueWrites === null ? _next2 : _valueWrites.listener(_next2);
        _clone.addEventListener("click", _listener);
      }
      _value2 = _next2;
    }
    const _next3 = _values[3];
    if (_next3 !== _value3 && !(_next3 !== _next3 && _value3 !== _value3)) {
      if (_valueSlot === null && (_next3 === null || typeof _next3 !== "object")) {
        _MD.setTextData(_text, _next3);
      } else {
        (_valueSlot ??= _MD.createIndexedValueSlot(_text, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_next3);
      }
      _value3 = _next3;
    }
    const _next4 = _values[4];
    if (_next4 !== _value4 && !(_next4 !== _next4 && _value4 !== _value4)) {
      if (_valueSlot2 === null && (_next4 === null || typeof _next4 !== "object")) {
        _MD.setTextData(_text2, _next4);
      } else {
        (_valueSlot2 ??= _MD.createIndexedValueSlot(_text2, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_next4);
      }
      _value4 = _next4;
    }
  }, dispose() {
    if (_valueSlot !== null) _valueSlot.dispose();
    _valueSlot = _MD.disposedValueSlot;
    if (_valueSlot2 !== null) _valueSlot2.dispose();
    _valueSlot2 = _MD.disposedValueSlot;
  } };
} };
_MD.defineComponent(BenchModuleDataInline, "./bench/dom/AppModuleDataInline.tsx#BenchModuleDataInline");
const _template = _MD.createTemplateCache([["li", 0, "", ": ", ""]]);
const _template2 = _MD.createTemplateCache([["div", 0, ["div", ["class", "toolbar"], ["button", 0, "create1k"], ["button", 0, "create10k"], ["button", 0, "append1k"], ["button", 0, "prepend1k"], ["button", 0, "pop1k"], ["button", 0, "update"], ["button", 0, "swap"], ["button", 0, "reverse"], ["button", 0, "remove"], ["button", 0, "remove100"], ["button", 0, "clear"]], ["ul", 0, ""]]]);
const _template3 = _MD.createTemplateCache([["li", 0, "", ": ", ""]]);
let _dataVersion = 0;
const _sharedKey = {};
function _mutated_data() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _version_data() {
  if (_MD.isBuilding()) _refreshShared();
  return _dataVersion;
}
function _read_data() {
  if (_MD.isBuilding()) _refreshShared();
  return _MD.trackRead(_version_data, data, _sharedKey);
}
export { _read_data };
const _sharedScope = _MD.createBuildScope(true, false);
const _effectInvocation = _MD.isEffectInvocation();
let _sharedReady = false;
const _sharedWrites = _MD.createSharedWrites([_sharedKey], []);
function _completeShared(_result) {
  _sharedReady = true;
  _sharedScope.leave(_sharedFrame);
  return _result;
}
function _refreshShared() {
  if (_effectInvocation || !_sharedReady || !_sharedWrites.stale() || _sharedScope.active()) return;
  _sharedWrites.refreshing();
  const _sharedFrame = _sharedScope.enter();
  _sharedWrites.check();
  _sharedScope.leave(_sharedFrame);
}
const _sharedFrame = _sharedScope.enter();
import { buildData } from './data';
let data = [];
_sharedWrites.watch([{ read: () => data, notify: _mutated_data }]);
export function BenchModuleDataInline(_id, _parent, _props, _namespace2, _setupOnly) {
  let _selectedVersion = 0;
  const _readKey = {};
  function _write(_value5) {
    _selectedVersion++;
    _writes.mark();
    return _value5;
  }
  const _entity = { id: _id, parent: _parent, render: _update };
  const _writes = _MD.createWriteBatch(_entity);
  _MD.registerEntity(_entity);
  const _scope = _MD.createBuildScope();
  const _setupFrame = _scope.enter(() => {
    if (_MD.getEntity(_id) === _entity) {
      _MD.unregisterSubtree(_id);
    }
  });
  let selected = null;
  if (_setupOnly) {
    _scope.leave(_setupFrame);
    return;
  }
  _writes.beginMount();
  const _document2 = _MD.getActiveEnvironment().document;
  const _clone2 = _MD.cloneTemplate(_template2, _namespace2);
  const _node2 = _clone2.firstChild;
  const _button = _node2.firstChild;
  const _button2 = _button.nextSibling;
  const _button3 = _button2.nextSibling;
  const _button4 = _button3.nextSibling;
  const _button5 = _button4.nextSibling;
  const _button6 = _button5.nextSibling;
  const _button7 = _button6.nextSibling;
  const _button8 = _button7.nextSibling;
  const _button9 = _button8.nextSibling;
  const _button10 = _button9.nextSibling;
  const _button11 = _button10.nextSibling;
  const _node3 = _node2.nextSibling;
  const _text3 = _node3.firstChild;
  let _value6 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(1000);
    _write(selected = null);
  };
  let _listener2;
  if (_listener2 !== undefined) _button.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value6 === "function") {
    _listener2 = _writes === null ? _value6 : _writes.listener(_value6);
    _button.addEventListener("click", _listener2);
  }
  let _value7 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(10000);
    _write(selected = null);
  };
  let _listener3;
  if (_listener3 !== undefined) _button2.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value7 === "function") {
    _listener3 = _writes === null ? _value7 : _writes.listener(_value7);
    _button2.addEventListener("click", _listener3);
  }
  let _value8 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "concat", 0, void 0)(buildData(1000));
  };
  let _listener4;
  if (_listener4 !== undefined) _button3.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value8 === "function") {
    _listener4 = _writes === null ? _value8 : _writes.listener(_value8);
    _button3.addEventListener("click", _listener4);
  }
  let _value9 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_read_data());
  };
  let _listener5;
  if (_listener5 !== undefined) _button4.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value9 === "function") {
    _listener5 = _writes === null ? _value9 : _writes.listener(_value9);
    _button4.addEventListener("click", _listener5);
  }
  let _value10 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "slice", 0, void 0)(0, -1000);
  };
  let _listener6;
  if (_listener6 !== undefined) _button5.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value10 === "function") {
    _listener6 = _writes === null ? _value10 : _writes.listener(_value10);
    _button5.addEventListener("click", _listener6);
  }
  let _value11 = () => {
    for (let i = 0; i < _read_data().length; i += 10) _MD.mutationTarget(_read_data()[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener7;
  if (_listener7 !== undefined) _button6.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value11 === "function") {
    _listener7 = _writes === null ? _value11 : _writes.listener(_value11);
    _button6.addEventListener("click", _listener7);
  }
  let _value12 = () => {
    if (_read_data().length > 998) {
      const t = _read_data()[1];
      _MD.mutationTarget(_read_data(), 1, _mutated_data).value = _read_data()[998];
      _MD.mutationTarget(_read_data(), 998, _mutated_data).value = t;
    }
  };
  let _listener8;
  if (_listener8 !== undefined) _button7.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value12 === "function") {
    _listener8 = _writes === null ? _value12 : _writes.listener(_value12);
    _button7.addEventListener("click", _listener8);
  }
  let _value13 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "reverse", 0, void 0)();
  };
  let _listener9;
  if (_listener9 !== undefined) _button8.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value13 === "function") {
    _listener9 = _writes === null ? _value13 : _writes.listener(_value13);
    _button8.addEventListener("click", _listener9);
  }
  let _value14 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "splice", 0, void 0)(500, 1);
  };
  let _listener10;
  if (_listener10 !== undefined) _button9.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value14 === "function") {
    _listener10 = _writes === null ? _value14 : _writes.listener(_value14);
    _button9.addEventListener("click", _listener10);
  }
  let _value15 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "filter", 1, void 0)((_item, index) => index % 100 !== 0);
  };
  let _listener11;
  if (_listener11 !== undefined) _button10.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value15 === "function") {
    _listener11 = _writes === null ? _value15 : _writes.listener(_value15);
    _button10.addEventListener("click", _listener11);
  }
  let _value16 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = [];
    _write(selected = null);
  };
  let _listener12;
  if (_listener12 !== undefined) _button11.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value16 === "function") {
    _listener12 = _writes === null ? _value16 : _writes.listener(_value16);
    _button11.addEventListener("click", _listener12);
  }
  const _rowNamespace = _MD.renderNamespace(_text3.parentNode, _namespace2);
  const _rowList = _MD.createRowList(_text3, { id: _id, batch: _writes, entity: _entity, namespace: _namespace2 }, (item) => item.id, (item) => {
    const _clone3 = _MD.cloneTemplate(_template3, _rowNamespace);
    const _text4 = _clone3.firstChild;
    const _node4 = _text4.nextSibling;
    const _text5 = _node4.nextSibling;
    let _value18 = selected === item.id ? 'danger' : '';
    if (_value18 != null && _value18 !== false) {
      _clone3.setAttribute("class", _value18 === true ? "" : _MD.textValue(_value18));
    } else {
      _clone3.removeAttribute("class");
    }
    let _value19 = () => {
      _write(selected = item.id);
    };
    let _listener13;
    if (_listener13 !== undefined) _clone3.removeEventListener("click", _listener13);
    _listener13 = undefined;
    if (typeof _value19 === "function") {
      _listener13 = _writes === null ? _value19 : _writes.listener(_value19);
      _clone3.addEventListener("click", _listener13);
    }
    let _value20 = item.id;
    let _valueSlot3 = null;
    if (_valueSlot3 === null && (_value20 === null || typeof _value20 !== "object")) {
      _MD.setTextData(_text4, _value20);
    } else {
      (_valueSlot3 ??= _MD.createIndexedValueSlot(_text4, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value20);
    }
    let _value21 = item.label;
    let _valueSlot4 = null;
    if (_valueSlot4 === null && (_value21 === null || typeof _value21 !== "object")) {
      _MD.setTextData(_text5, _value21);
    } else {
      (_valueSlot4 ??= _MD.createIndexedValueSlot(_text5, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value21);
    }
    return { node: _clone3, update(_item2) {
      item = _item2;
      const _next5 = selected === item.id ? 'danger' : '';
      if (_next5 !== _value18 && !(_next5 !== _next5 && _value18 !== _value18)) {
        if (_next5 != null && _next5 !== false) {
          _clone3.setAttribute("class", _next5 === true ? "" : _MD.textValue(_next5));
        } else {
          _clone3.removeAttribute("class");
        }
        _value18 = _next5;
      }
      const _next6 = item.id;
      if (_next6 !== _value20 && !(_next6 !== _next6 && _value20 !== _value20)) {
        if (_valueSlot3 === null && (_next6 === null || typeof _next6 !== "object")) {
          _MD.setTextData(_text4, _next6);
        } else {
          (_valueSlot3 ??= _MD.createIndexedValueSlot(_text4, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next6);
        }
        _value20 = _next6;
      }
      const _next7 = item.label;
      if (_next7 !== _value21 && !(_next7 !== _next7 && _value21 !== _value21)) {
        if (_valueSlot4 === null && (_next7 === null || typeof _next7 !== "object")) {
          _MD.setTextData(_text5, _next7);
        } else {
          (_valueSlot4 ??= _MD.createIndexedValueSlot(_text5, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next7);
        }
        _value21 = _next7;
      }
    }, dispose() {
      if (_valueSlot3 !== null) _valueSlot3.dispose();
      _valueSlot3 = _MD.disposedValueSlot;
      if (_valueSlot4 !== null) _valueSlot4.dispose();
      _valueSlot4 = _MD.disposedValueSlot;
    } };
  }, ["id"]);
  _rowList.route(() => selected, () => _selectedVersion, void 0);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  let _value17 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createKeyedRenderValue(_renderProgram, [item.id, _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '', () => {
    _write(selected = item.id);
  }, item.id, item.label], 0)));
  _siteComputation.end();
  _rowList.write(_value17);
  let _publishedVersion = _selectedVersion;
  _MD.cleanup(_id, () => {
    _rowList.dispose();
    _siteComputation.dispose();
  });
  _MD.watchMutationRoots(_entity, [{ read: () => selected, notify: () => {
    _selectedVersion++;
    if (!_scope.building()) _writes.mark();
  } }]);
  function _update() {
    const _updateFrame = _scope.enter();
    if (_siteComputation.changed() || _rowList.changed()) {
      _siteComputation.begin();
      const _next8 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createKeyedRenderValue(_renderProgram, [item.id, _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '', () => {
        _write(selected = item.id);
      }, item.id, item.label], 0)));
      _siteComputation.end();
      if (_next8 !== _value17 && !(_next8 !== _next8 && _value17 !== _value17)) {
        _rowList.write(_next8);
        _value17 = _next8;
      }
    }
    _rowList.refresh(_siteComputation);
    if (_publishedVersion !== _selectedVersion) {
      _publishedVersion = _selectedVersion;
      _MD.publishVersions([_readKey]);
    }
    _MD.checkMutationRoots(_entity);
    _scope.leave(_updateFrame);
  }
  _writes.activate();
  _scope.leave(_setupFrame);
  return _clone2;
}
_completeShared(void 0);

export function createModuleDataInline() {
  const root = BenchModuleDataInline('BenchModuleDataInline', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppModuleDataInline`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
