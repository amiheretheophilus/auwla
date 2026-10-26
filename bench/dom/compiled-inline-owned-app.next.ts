/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
const _renderProgram = { mount(_values, _owner) {
  const _document = _MD.getActiveEnvironment().document;
  const _valueId = _owner.id;
  const _valueEntity = _owner.entity;
  const _valueWrites = _owner.batch;
  const _namespace = _owner.namespace;
  if (_namespace === "svg") {
    let _text, _text2, _li2;
    const _clone = _MD.cloneTemplate(_template, void 0, _buildTemplate);
    if (_clone !== null) {
      const _node = _clone;
      const _node2 = _node.firstChild;
      _text = _node2;
      const _node3 = _node2.nextSibling;
      const _node4 = _node3.nextSibling;
      _text2 = _node4;
      _li2 = _node;
    } else {
      const _slot3 = _document.createComment("");
      const _static2 = _document.createTextNode(": ");
      const _slot4 = _document.createComment("");
      const _li3 = _document.createElementNS("http://www.w3.org/2000/svg", "li");
      _li3.append(_slot3, _static2, _slot4);
      const _text3 = _document.createTextNode("");
      _slot3.replaceWith(_text3);
      const _text4 = _document.createTextNode("");
      _slot4.replaceWith(_text4);
      _text = _text3;
      _text2 = _text4;
      _li2 = _li3;
    }
    let _value = _values[1];
    if (_value != null && _value !== false) {
      _li2.setAttribute("class", _value === true ? "" : _MD.textValue(_value));
    } else {
      _li2.removeAttribute("class");
    }
    let _value2 = _values[2];
    let _listener;
    if (_listener !== undefined) _li2.removeEventListener("click", _listener);
    _listener = undefined;
    if (typeof _value2 === "function") {
      _listener = _valueWrites === null ? _value2 : _valueWrites.listener(_value2);
      _li2.addEventListener("click", _listener);
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
    return { nodes: [_li2], update(_values2) {
      _values = _values2;
      const _next = _values[1];
      if (_next !== _value && !(_next !== _next && _value !== _value)) {
        if (_next != null && _next !== false) {
          _li2.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
        } else {
          _li2.removeAttribute("class");
        }
        _value = _next;
      }
      const _next2 = _values[2];
      if (_next2 !== _value2 && !(_next2 !== _next2 && _value2 !== _value2)) {
        if (_listener !== undefined) _li2.removeEventListener("click", _listener);
        _listener = undefined;
        if (typeof _next2 === "function") {
          _listener = _valueWrites === null ? _next2 : _valueWrites.listener(_next2);
          _li2.addEventListener("click", _listener);
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
  }
  const _valueMarkup = "<li><!---->: <!----></li>";
  let _text5, _text6, _li5;
  const _clone2 = _MD.cloneTemplate(_template2, void 0, _buildTemplate2);
  if (_clone2 !== null) {
    const _node5 = _clone2;
    const _node6 = _node5.firstChild;
    _text5 = _node6;
    const _node7 = _node6.nextSibling;
    const _node8 = _node7.nextSibling;
    _text6 = _node8;
    _li5 = _node5;
  } else {
    const _nodes = _MD.materializeMarkup(_valueMarkup);
    const _slot7 = _nodes[0];
    const _slot8 = _nodes[2];
    const _li6 = _nodes[3];
    const _text7 = _document.createTextNode("");
    _slot7.replaceWith(_text7);
    const _text8 = _document.createTextNode("");
    _slot8.replaceWith(_text8);
    _text5 = _text7;
    _text6 = _text8;
    _li5 = _li6;
  }
  let _value5 = _values[1];
  if (_value5 != null && _value5 !== false) {
    _li5.setAttribute("class", _value5 === true ? "" : _MD.textValue(_value5));
  } else {
    _li5.removeAttribute("class");
  }
  let _value6 = _values[2];
  let _listener2;
  if (_listener2 !== undefined) _li5.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value6 === "function") {
    _listener2 = _valueWrites === null ? _value6 : _valueWrites.listener(_value6);
    _li5.addEventListener("click", _listener2);
  }
  let _value7 = _values[3];
  let _valueSlot3 = null;
  if (_valueSlot3 === null && (_value7 === null || typeof _value7 !== "object")) {
    _MD.setTextData(_text5, _value7);
  } else {
    (_valueSlot3 ??= _MD.createIndexedValueSlot(_text5, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_value7);
  }
  let _value8 = _values[4];
  let _valueSlot4 = null;
  if (_valueSlot4 === null && (_value8 === null || typeof _value8 !== "object")) {
    _MD.setTextData(_text6, _value8);
  } else {
    (_valueSlot4 ??= _MD.createIndexedValueSlot(_text6, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_value8);
  }
  return { nodes: [_li5], update(_values2) {
    _values = _values2;
    const _next5 = _values[1];
    if (_next5 !== _value5 && !(_next5 !== _next5 && _value5 !== _value5)) {
      if (_next5 != null && _next5 !== false) {
        _li5.setAttribute("class", _next5 === true ? "" : _MD.textValue(_next5));
      } else {
        _li5.removeAttribute("class");
      }
      _value5 = _next5;
    }
    const _next6 = _values[2];
    if (_next6 !== _value6 && !(_next6 !== _next6 && _value6 !== _value6)) {
      if (_listener2 !== undefined) _li5.removeEventListener("click", _listener2);
      _listener2 = undefined;
      if (typeof _next6 === "function") {
        _listener2 = _valueWrites === null ? _next6 : _valueWrites.listener(_next6);
        _li5.addEventListener("click", _listener2);
      }
      _value6 = _next6;
    }
    const _next7 = _values[3];
    if (_next7 !== _value7 && !(_next7 !== _next7 && _value7 !== _value7)) {
      if (_valueSlot3 === null && (_next7 === null || typeof _next7 !== "object")) {
        _MD.setTextData(_text5, _next7);
      } else {
        (_valueSlot3 ??= _MD.createIndexedValueSlot(_text5, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_next7);
      }
      _value7 = _next7;
    }
    const _next8 = _values[4];
    if (_next8 !== _value8 && !(_next8 !== _next8 && _value8 !== _value8)) {
      if (_valueSlot4 === null && (_next8 === null || typeof _next8 !== "object")) {
        _MD.setTextData(_text6, _next8);
      } else {
        (_valueSlot4 ??= _MD.createIndexedValueSlot(_text6, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_next8);
      }
      _value8 = _next8;
    }
  }, dispose() {
    if (_valueSlot3 !== null) _valueSlot3.dispose();
    _valueSlot3 = _MD.disposedValueSlot;
    if (_valueSlot4 !== null) _valueSlot4.dispose();
    _valueSlot4 = _MD.disposedValueSlot;
  } };
} };
const _markup = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul><!----></ul></div>";
_MD.defineComponent(BenchAppInlineOwned, "./bench/dom/AppInlineOwned.tsx#BenchAppInlineOwned");
const _template = _MD.createTemplateCache();
function _buildTemplate(_document2, _namespace2) {
  const _slot = _document2.createTextNode("");
  const _static = _document2.createTextNode(": ");
  const _slot2 = _document2.createTextNode("");
  const _li = _document2.createElementNS("http://www.w3.org/2000/svg", "li");
  _li.append(_slot, _static, _slot2);
  return _li;
}
const _template2 = _MD.createTemplateCache();
function _buildTemplate2(_document3, _namespace3) {
  const _slot5 = _document3.createTextNode("");
  const _static3 = _document3.createTextNode(": ");
  const _slot6 = _document3.createTextNode("");
  const _li4 = _document3.createElement("li");
  _li4.append(_slot5, _static3, _slot6);
  return _li4;
}
const _template3 = _MD.createTemplateCache();
function _buildTemplate3(_document5, _namespace5) {
  const _static4 = _document5.createTextNode("create1k");
  const _button = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button.append(_static4);
  const _static5 = _document5.createTextNode("create10k");
  const _button2 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button2.append(_static5);
  const _static6 = _document5.createTextNode("append1k");
  const _button3 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button3.append(_static6);
  const _static7 = _document5.createTextNode("prepend1k");
  const _button4 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button4.append(_static7);
  const _static8 = _document5.createTextNode("pop1k");
  const _button5 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button5.append(_static8);
  const _static9 = _document5.createTextNode("update");
  const _button6 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button6.append(_static9);
  const _static10 = _document5.createTextNode("swap");
  const _button7 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button7.append(_static10);
  const _static11 = _document5.createTextNode("reverse");
  const _button8 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button8.append(_static11);
  const _static12 = _document5.createTextNode("remove");
  const _button9 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button9.append(_static12);
  const _static13 = _document5.createTextNode("remove100");
  const _button10 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button10.append(_static13);
  const _static14 = _document5.createTextNode("clear");
  const _button11 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "button") : _document5.createElement("button");
  _button11.append(_static14);
  const _div = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "div") : _document5.createElement("div");
  _div.setAttribute("class", "toolbar");
  _div.append(_button, _button2, _button3, _button4, _button5, _button6, _button7, _button8, _button9, _button10, _button11);
  const _slot9 = _document5.createTextNode("");
  const _ul = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "ul") : _document5.createElement("ul");
  _ul.append(_slot9);
  const _div2 = _namespace5 === "svg" ? _document5.createElementNS("http://www.w3.org/2000/svg", "div") : _document5.createElement("div");
  _div2.append(_div, _ul);
  return _div2;
}
const _template4 = _MD.createTemplateCache();
function _buildTemplate4(_document6, _namespace6) {
  const _slot12 = _document6.createTextNode("");
  const _static26 = _document6.createTextNode(": ");
  const _slot13 = _document6.createTextNode("");
  const _li7 = _document6.createElementNS("http://www.w3.org/2000/svg", "li");
  _li7.append(_slot12, _static26, _slot13);
  return _li7;
}
const _template5 = _MD.createTemplateCache();
function _buildTemplate5(_document7, _namespace7) {
  const _slot16 = _document7.createTextNode("");
  const _static28 = _document7.createTextNode(": ");
  const _slot17 = _document7.createTextNode("");
  const _li10 = _document7.createElement("li");
  _li10.append(_slot16, _static28, _slot17);
  return _li10;
}
import { buildData } from './data';
export function BenchAppInlineOwned(_id, _parent, _props, _namespace4, _setupOnly) {
  let _dataVersion = 0;
  let _selectedVersion = 0;
  const _readKey = {};
  const _readKey2 = {};
  function _mutated_data() {
    _dataVersion++;
    _writes.mark();
  }
  function _write(_value9) {
    _dataVersion++;
    _writes.mark();
    return _value9;
  }
  function _write2(_value10) {
    _selectedVersion++;
    _writes.mark();
    return _value10;
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
  let data = [];
  let selected = null;
  if (_setupOnly) {
    _scope.leave(_setupFrame);
    return;
  }
  _writes.beginMount();
  const _document4 = _MD.getActiveEnvironment().document;
  let _button12, _button13, _button14, _button15, _button16, _button17, _button18, _button19, _button20, _button21, _button22, _text9, _div3;
  const _clone3 = _MD.cloneTemplate(_template3, _namespace4, _buildTemplate3);
  if (_clone3 !== null) {
    const _node9 = _clone3;
    const _node10 = _node9.firstChild;
    const _node11 = _node10.firstChild;
    _button12 = _node11;
    const _node12 = _node11.nextSibling;
    _button13 = _node12;
    const _node13 = _node12.nextSibling;
    _button14 = _node13;
    const _node14 = _node13.nextSibling;
    _button15 = _node14;
    const _node15 = _node14.nextSibling;
    _button16 = _node15;
    const _node16 = _node15.nextSibling;
    _button17 = _node16;
    const _node17 = _node16.nextSibling;
    _button18 = _node17;
    const _node18 = _node17.nextSibling;
    _button19 = _node18;
    const _node19 = _node18.nextSibling;
    _button20 = _node19;
    const _node20 = _node19.nextSibling;
    _button21 = _node20;
    const _node21 = _node20.nextSibling;
    _button22 = _node21;
    const _node22 = _node10.nextSibling;
    const _node23 = _node22.firstChild;
    _text9 = _node23;
    _div3 = _node9;
  } else {
    const _nodes2 = _namespace4 === "svg" ? (() => {
      const _static15 = _document4.createTextNode("create1k");
      const _button23 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button23.append(_static15);
      const _static16 = _document4.createTextNode("create10k");
      const _button24 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button24.append(_static16);
      const _static17 = _document4.createTextNode("append1k");
      const _button25 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button25.append(_static17);
      const _static18 = _document4.createTextNode("prepend1k");
      const _button26 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button26.append(_static18);
      const _static19 = _document4.createTextNode("pop1k");
      const _button27 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button27.append(_static19);
      const _static20 = _document4.createTextNode("update");
      const _button28 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button28.append(_static20);
      const _static21 = _document4.createTextNode("swap");
      const _button29 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button29.append(_static21);
      const _static22 = _document4.createTextNode("reverse");
      const _button30 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button30.append(_static22);
      const _static23 = _document4.createTextNode("remove");
      const _button31 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button31.append(_static23);
      const _static24 = _document4.createTextNode("remove100");
      const _button32 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button32.append(_static24);
      const _static25 = _document4.createTextNode("clear");
      const _button33 = _document4.createElementNS("http://www.w3.org/2000/svg", "button");
      _button33.append(_static25);
      const _div4 = _document4.createElementNS("http://www.w3.org/2000/svg", "div");
      _div4.setAttribute("class", "toolbar");
      _div4.append(_button23, _button24, _button25, _button26, _button27, _button28, _button29, _button30, _button31, _button32, _button33);
      const _slot10 = _document4.createComment("");
      const _ul2 = _document4.createElementNS("http://www.w3.org/2000/svg", "ul");
      _ul2.append(_slot10);
      const _div5 = _document4.createElementNS("http://www.w3.org/2000/svg", "div");
      _div5.append(_div4, _ul2);
      return [_static15, _button23, _static16, _button24, _static17, _button25, _static18, _button26, _static19, _button27, _static20, _button28, _static21, _button29, _static22, _button30, _static23, _button31, _static24, _button32, _static25, _button33, _div4, _slot10, _ul2, _div5];
    })() : _MD.materializeMarkup(_markup);
    const _button34 = _nodes2[1];
    const _button35 = _nodes2[3];
    const _button36 = _nodes2[5];
    const _button37 = _nodes2[7];
    const _button38 = _nodes2[9];
    const _button39 = _nodes2[11];
    const _button40 = _nodes2[13];
    const _button41 = _nodes2[15];
    const _button42 = _nodes2[17];
    const _button43 = _nodes2[19];
    const _button44 = _nodes2[21];
    const _slot11 = _nodes2[23];
    const _div6 = _nodes2[25];
    const _text10 = _document4.createTextNode("");
    _slot11.replaceWith(_text10);
    _button12 = _button34;
    _button13 = _button35;
    _button14 = _button36;
    _button15 = _button37;
    _button16 = _button38;
    _button17 = _button39;
    _button18 = _button40;
    _button19 = _button41;
    _button20 = _button42;
    _button21 = _button43;
    _button22 = _button44;
    _text9 = _text10;
    _div3 = _div6;
  }
  let _value11 = () => {
    _write(data = buildData(1000));
    _write2(selected = null);
  };
  let _listener3;
  if (_listener3 !== undefined) _button12.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value11 === "function") {
    _listener3 = _writes === null ? _value11 : _writes.listener(_value11);
    _button12.addEventListener("click", _listener3);
  }
  let _value12 = () => {
    _write(data = buildData(10000));
    _write2(selected = null);
  };
  let _listener4;
  if (_listener4 !== undefined) _button13.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value12 === "function") {
    _listener4 = _writes === null ? _value12 : _writes.listener(_value12);
    _button13.addEventListener("click", _listener4);
  }
  let _value13 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "concat", 0, void 0)(buildData(1000)));
  };
  let _listener5;
  if (_listener5 !== undefined) _button14.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value13 === "function") {
    _listener5 = _writes === null ? _value13 : _writes.listener(_value13);
    _button14.addEventListener("click", _listener5);
  }
  let _value14 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_MD.trackRead(() => _dataVersion, data, _readKey)));
  };
  let _listener6;
  if (_listener6 !== undefined) _button15.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value14 === "function") {
    _listener6 = _writes === null ? _value14 : _writes.listener(_value14);
    _button15.addEventListener("click", _listener6);
  }
  let _value15 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "slice", 0, void 0)(0, -1000));
  };
  let _listener7;
  if (_listener7 !== undefined) _button16.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value15 === "function") {
    _listener7 = _writes === null ? _value15 : _writes.listener(_value15);
    _button16.addEventListener("click", _listener7);
  }
  let _value16 = () => {
    for (let i = 0; i < _MD.trackRead(() => _dataVersion, data, _readKey).length; i += 10) _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey)[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener8;
  if (_listener8 !== undefined) _button17.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value16 === "function") {
    _listener8 = _writes === null ? _value16 : _writes.listener(_value16);
    _button17.addEventListener("click", _listener8);
  }
  let _value17 = () => {
    if (_MD.trackRead(() => _dataVersion, data, _readKey).length > 998) {
      const t = _MD.trackRead(() => _dataVersion, data, _readKey)[1];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 1, _mutated_data).value = _MD.trackRead(() => _dataVersion, data, _readKey)[998];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 998, _mutated_data).value = t;
    }
  };
  let _listener9;
  if (_listener9 !== undefined) _button18.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value17 === "function") {
    _listener9 = _writes === null ? _value17 : _writes.listener(_value17);
    _button18.addEventListener("click", _listener9);
  }
  let _value18 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "reverse", 0, void 0)();
  };
  let _listener10;
  if (_listener10 !== undefined) _button19.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value18 === "function") {
    _listener10 = _writes === null ? _value18 : _writes.listener(_value18);
    _button19.addEventListener("click", _listener10);
  }
  let _value19 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "splice", 0, void 0)(500, 1);
  };
  let _listener11;
  if (_listener11 !== undefined) _button20.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value19 === "function") {
    _listener11 = _writes === null ? _value19 : _writes.listener(_value19);
    _button20.addEventListener("click", _listener11);
  }
  let _value20 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "filter", 1, void 0)((_item, index) => index % 100 !== 0));
  };
  let _listener12;
  if (_listener12 !== undefined) _button21.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value20 === "function") {
    _listener12 = _writes === null ? _value20 : _writes.listener(_value20);
    _button21.addEventListener("click", _listener12);
  }
  let _value21 = () => {
    _write(data = []);
    _write2(selected = null);
  };
  let _listener13;
  if (_listener13 !== undefined) _button22.removeEventListener("click", _listener13);
  _listener13 = undefined;
  if (typeof _value21 === "function") {
    _listener13 = _writes === null ? _value21 : _writes.listener(_value21);
    _button22.addEventListener("click", _listener13);
  }
  const _rowNamespace = _MD.renderNamespace(_text9.parentNode, _namespace4);
  const _rowList = _MD.createRowList(_text9, { id: _id, batch: _writes, entity: _entity, namespace: _namespace4 }, (item) => item.id, (item) => {
    if (_rowNamespace === "svg") {
      let _text11, _text12, _li8;
      const _clone4 = _MD.cloneTemplate(_template4, void 0, _buildTemplate4);
      if (_clone4 !== null) {
        const _node24 = _clone4;
        const _node25 = _node24.firstChild;
        _text11 = _node25;
        const _node26 = _node25.nextSibling;
        const _node27 = _node26.nextSibling;
        _text12 = _node27;
        _li8 = _node24;
      } else {
        const _slot14 = _document4.createComment("");
        const _static27 = _document4.createTextNode(": ");
        const _slot15 = _document4.createComment("");
        const _li9 = _document4.createElementNS("http://www.w3.org/2000/svg", "li");
        _li9.append(_slot14, _static27, _slot15);
        const _text13 = _document4.createTextNode("");
        _slot14.replaceWith(_text13);
        const _text14 = _document4.createTextNode("");
        _slot15.replaceWith(_text14);
        _text11 = _text13;
        _text12 = _text14;
        _li8 = _li9;
      }
      let _value23 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2) ? 'danger' : '';
      if (_value23 != null && _value23 !== false) {
        _li8.setAttribute("class", _value23 === true ? "" : _MD.textValue(_value23));
      } else {
        _li8.removeAttribute("class");
      }
      let _value24 = () => {
        _write2(selected = item.id);
      };
      let _listener14;
      if (_listener14 !== undefined) _li8.removeEventListener("click", _listener14);
      _listener14 = undefined;
      if (typeof _value24 === "function") {
        _listener14 = _writes === null ? _value24 : _writes.listener(_value24);
        _li8.addEventListener("click", _listener14);
      }
      let _value25 = item.id;
      let _valueSlot5 = null;
      if (_valueSlot5 === null && (_value25 === null || typeof _value25 !== "object")) {
        _MD.setTextData(_text11, _value25);
      } else {
        (_valueSlot5 ??= _MD.createIndexedValueSlot(_text11, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value25);
      }
      let _value26 = item.label;
      let _valueSlot6 = null;
      if (_valueSlot6 === null && (_value26 === null || typeof _value26 !== "object")) {
        _MD.setTextData(_text12, _value26);
      } else {
        (_valueSlot6 ??= _MD.createIndexedValueSlot(_text12, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value26);
      }
      return { node: _li8, update(_item2) {
        item = _item2;
        const _next9 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2) ? 'danger' : '';
        if (_next9 !== _value23 && !(_next9 !== _next9 && _value23 !== _value23)) {
          if (_next9 != null && _next9 !== false) {
            _li8.setAttribute("class", _next9 === true ? "" : _MD.textValue(_next9));
          } else {
            _li8.removeAttribute("class");
          }
          _value23 = _next9;
        }
        const _next10 = item.id;
        if (_next10 !== _value25 && !(_next10 !== _next10 && _value25 !== _value25)) {
          if (_valueSlot5 === null && (_next10 === null || typeof _next10 !== "object")) {
            _MD.setTextData(_text11, _next10);
          } else {
            (_valueSlot5 ??= _MD.createIndexedValueSlot(_text11, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next10);
          }
          _value25 = _next10;
        }
        const _next11 = item.label;
        if (_next11 !== _value26 && !(_next11 !== _next11 && _value26 !== _value26)) {
          if (_valueSlot6 === null && (_next11 === null || typeof _next11 !== "object")) {
            _MD.setTextData(_text12, _next11);
          } else {
            (_valueSlot6 ??= _MD.createIndexedValueSlot(_text12, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next11);
          }
          _value26 = _next11;
        }
      }, dispose() {
        if (_valueSlot5 !== null) _valueSlot5.dispose();
        _valueSlot5 = _MD.disposedValueSlot;
        if (_valueSlot6 !== null) _valueSlot6.dispose();
        _valueSlot6 = _MD.disposedValueSlot;
      } };
    }
    const _rowMarkup = "<li><!---->: <!----></li>";
    let _text15, _text16, _li11;
    const _clone5 = _MD.cloneTemplate(_template5, void 0, _buildTemplate5);
    if (_clone5 !== null) {
      const _node28 = _clone5;
      const _node29 = _node28.firstChild;
      _text15 = _node29;
      const _node30 = _node29.nextSibling;
      const _node31 = _node30.nextSibling;
      _text16 = _node31;
      _li11 = _node28;
    } else {
      const _nodes3 = _MD.materializeMarkup(_rowMarkup);
      const _slot18 = _nodes3[0];
      const _slot19 = _nodes3[2];
      const _li12 = _nodes3[3];
      const _text17 = _document4.createTextNode("");
      _slot18.replaceWith(_text17);
      const _text18 = _document4.createTextNode("");
      _slot19.replaceWith(_text18);
      _text15 = _text17;
      _text16 = _text18;
      _li11 = _li12;
    }
    let _value27 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2) ? 'danger' : '';
    if (_value27 != null && _value27 !== false) {
      _li11.setAttribute("class", _value27 === true ? "" : _MD.textValue(_value27));
    } else {
      _li11.removeAttribute("class");
    }
    let _value28 = () => {
      _write2(selected = item.id);
    };
    let _listener15;
    if (_listener15 !== undefined) _li11.removeEventListener("click", _listener15);
    _listener15 = undefined;
    if (typeof _value28 === "function") {
      _listener15 = _writes === null ? _value28 : _writes.listener(_value28);
      _li11.addEventListener("click", _listener15);
    }
    let _value29 = item.id;
    let _valueSlot7 = null;
    if (_valueSlot7 === null && (_value29 === null || typeof _value29 !== "object")) {
      _MD.setTextData(_text15, _value29);
    } else {
      (_valueSlot7 ??= _MD.createIndexedValueSlot(_text15, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value29);
    }
    let _value30 = item.label;
    let _valueSlot8 = null;
    if (_valueSlot8 === null && (_value30 === null || typeof _value30 !== "object")) {
      _MD.setTextData(_text16, _value30);
    } else {
      (_valueSlot8 ??= _MD.createIndexedValueSlot(_text16, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value30);
    }
    return { node: _li11, update(_item3) {
      item = _item3;
      const _next12 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2) ? 'danger' : '';
      if (_next12 !== _value27 && !(_next12 !== _next12 && _value27 !== _value27)) {
        if (_next12 != null && _next12 !== false) {
          _li11.setAttribute("class", _next12 === true ? "" : _MD.textValue(_next12));
        } else {
          _li11.removeAttribute("class");
        }
        _value27 = _next12;
      }
      const _next13 = item.id;
      if (_next13 !== _value29 && !(_next13 !== _next13 && _value29 !== _value29)) {
        if (_valueSlot7 === null && (_next13 === null || typeof _next13 !== "object")) {
          _MD.setTextData(_text15, _next13);
        } else {
          (_valueSlot7 ??= _MD.createIndexedValueSlot(_text15, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next13);
        }
        _value29 = _next13;
      }
      const _next14 = item.label;
      if (_next14 !== _value30 && !(_next14 !== _next14 && _value30 !== _value30)) {
        if (_valueSlot8 === null && (_next14 === null || typeof _next14 !== "object")) {
          _MD.setTextData(_text16, _next14);
        } else {
          (_valueSlot8 ??= _MD.createIndexedValueSlot(_text16, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next14);
        }
        _value30 = _next14;
      }
    }, dispose() {
      if (_valueSlot7 !== null) _valueSlot7.dispose();
      _valueSlot7 = _MD.disposedValueSlot;
      if (_valueSlot8 !== null) _valueSlot8.dispose();
      _valueSlot8 = _MD.disposedValueSlot;
    } };
  });
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  let _value22 = _MD.observeMethod([() => data], [_mutated_data], data, "map", 1, _rowList)((item) => (_MD.createKeyedRenderValue(_renderProgram, [item.id, _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2) ? 'danger' : '', () => {
    _write2(selected = item.id);
  }, item.id, item.label], 0)));
  _siteComputation.end();
  _rowList.write(_value22);
  let _seen = _dataVersion;
  let _publishedVersion = _dataVersion;
  let _publishedVersion2 = _selectedVersion;
  _MD.cleanup(_id, () => {
    _rowList.dispose();
    _siteComputation.dispose();
  });
  _MD.watchMutationRoots(_entity, [{ read: () => data, notify: () => {
    _dataVersion++;
    if (!_scope.building()) _writes.mark();
  }, direct: _mutated_data }, { read: () => selected, notify: () => {
    _selectedVersion++;
    if (!_scope.building()) _writes.mark();
  } }]);
  function _update() {
    const _updateFrame = _scope.enter();
    if (_dataVersion !== _seen || _siteComputation.changed()) {
      _siteComputation.begin();
      const _next15 = _MD.observeMethod([() => data], [_mutated_data], data, "map", 1, _rowList)((item) => (_MD.createKeyedRenderValue(_renderProgram, [item.id, _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2) ? 'danger' : '', () => {
        _write2(selected = item.id);
      }, item.id, item.label], 0)));
      _siteComputation.end();
      if (_next15 !== _value22 && !(_next15 !== _next15 && _value22 !== _value22)) {
        _rowList.write(_next15);
        _value22 = _next15;
      }
      _seen = _dataVersion;
    }
    if (_publishedVersion !== _dataVersion) {
      _publishedVersion = _dataVersion;
      _MD.publishVersions([_readKey]);
    }
    if (_publishedVersion2 !== _selectedVersion) {
      _publishedVersion2 = _selectedVersion;
      _MD.publishVersions([_readKey2]);
    }
    _MD.checkMutationRoots(_entity);
    _scope.leave(_updateFrame);
  }
  _writes.activate();
  _scope.leave(_setupFrame);
  return _div3;
}

export function createCompiledInlineOwnedApp() {
  const root = BenchAppInlineOwned('BenchAppInlineOwned', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppInlineOwned`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
