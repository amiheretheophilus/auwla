/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
const _renderProgram = { mount(_values, _owner) {
  const _document = _MD.getActiveEnvironment().document;
  const _valueId = _owner.id;
  const _valueEntity = _owner.entity;
  const _valueWrites = _owner.batch;
  const _namespace = _owner.namespace;
  if (_namespace === "svg") {
    const _slot = _document.createComment("");
    const _static = _document.createTextNode(": ");
    const _slot2 = _document.createComment("");
    const _li = _document.createElementNS("http://www.w3.org/2000/svg", "li");
    _li.append(_slot, _static, _slot2);
    const _text = _document.createTextNode("");
    _slot.replaceWith(_text);
    const _text2 = _document.createTextNode("");
    _slot2.replaceWith(_text2);
    let _value = _values[1];
    if (_value != null && _value !== false) {
      _li.setAttribute("class", _value === true ? "" : _MD.textValue(_value));
    } else {
      _li.removeAttribute("class");
    }
    let _value2 = _values[2];
    let _listener;
    if (_listener !== undefined) _li.removeEventListener("click", _listener);
    _listener = undefined;
    if (typeof _value2 === "function") {
      _listener = _valueWrites === null ? _value2 : _valueWrites.listener(_value2);
      _li.addEventListener("click", _listener);
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
    return { nodes: [_li], update(_values2) {
      _values = _values2;
      const _next = _values[1];
      if (_next !== _value && !(_next !== _next && _value !== _value)) {
        if (_next != null && _next !== false) {
          _li.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
        } else {
          _li.removeAttribute("class");
        }
        _value = _next;
      }
      const _next2 = _values[2];
      if (_next2 !== _value2 && !(_next2 !== _next2 && _value2 !== _value2)) {
        if (_listener !== undefined) _li.removeEventListener("click", _listener);
        _listener = undefined;
        if (typeof _next2 === "function") {
          _listener = _valueWrites === null ? _next2 : _valueWrites.listener(_next2);
          _li.addEventListener("click", _listener);
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
  const _nodes = _MD.materializeMarkup(_valueMarkup);
  const _slot3 = _nodes[0];
  const _slot4 = _nodes[2];
  const _li2 = _nodes[3];
  const _text3 = _document.createTextNode("");
  _slot3.replaceWith(_text3);
  const _text4 = _document.createTextNode("");
  _slot4.replaceWith(_text4);
  let _value5 = _values[1];
  if (_value5 != null && _value5 !== false) {
    _li2.setAttribute("class", _value5 === true ? "" : _MD.textValue(_value5));
  } else {
    _li2.removeAttribute("class");
  }
  let _value6 = _values[2];
  let _listener2;
  if (_listener2 !== undefined) _li2.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value6 === "function") {
    _listener2 = _valueWrites === null ? _value6 : _valueWrites.listener(_value6);
    _li2.addEventListener("click", _listener2);
  }
  let _value7 = _values[3];
  let _valueSlot3 = null;
  if (_valueSlot3 === null && (_value7 === null || typeof _value7 !== "object")) {
    _MD.setTextData(_text3, _value7);
  } else {
    (_valueSlot3 ??= _MD.createIndexedValueSlot(_text3, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_value7);
  }
  let _value8 = _values[4];
  let _valueSlot4 = null;
  if (_valueSlot4 === null && (_value8 === null || typeof _value8 !== "object")) {
    _MD.setTextData(_text4, _value8);
  } else {
    (_valueSlot4 ??= _MD.createIndexedValueSlot(_text4, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_value8);
  }
  return { nodes: [_li2], update(_values2) {
    _values = _values2;
    const _next5 = _values[1];
    if (_next5 !== _value5 && !(_next5 !== _next5 && _value5 !== _value5)) {
      if (_next5 != null && _next5 !== false) {
        _li2.setAttribute("class", _next5 === true ? "" : _MD.textValue(_next5));
      } else {
        _li2.removeAttribute("class");
      }
      _value5 = _next5;
    }
    const _next6 = _values[2];
    if (_next6 !== _value6 && !(_next6 !== _next6 && _value6 !== _value6)) {
      if (_listener2 !== undefined) _li2.removeEventListener("click", _listener2);
      _listener2 = undefined;
      if (typeof _next6 === "function") {
        _listener2 = _valueWrites === null ? _next6 : _valueWrites.listener(_next6);
        _li2.addEventListener("click", _listener2);
      }
      _value6 = _next6;
    }
    const _next7 = _values[3];
    if (_next7 !== _value7 && !(_next7 !== _next7 && _value7 !== _value7)) {
      if (_valueSlot3 === null && (_next7 === null || typeof _next7 !== "object")) {
        _MD.setTextData(_text3, _next7);
      } else {
        (_valueSlot3 ??= _MD.createIndexedValueSlot(_text3, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_next7);
      }
      _value7 = _next7;
    }
    const _next8 = _values[4];
    if (_next8 !== _value8 && !(_next8 !== _next8 && _value8 !== _value8)) {
      if (_valueSlot4 === null && (_next8 === null || typeof _next8 !== "object")) {
        _MD.setTextData(_text4, _next8);
      } else {
        (_valueSlot4 ??= _MD.createIndexedValueSlot(_text4, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace })).write(_next8);
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
_MD.defineComponent(BenchModuleDataInline, "./bench/dom/AppModuleDataInline.tsx#BenchModuleDataInline");
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
let _sharedReady = false;
const _sharedWrites = _MD.createSharedWrites([_sharedKey], []);
function _completeShared(_result) {
  _sharedReady = true;
  _sharedScope.leave(_sharedFrame);
  return _result;
}
function _refreshShared() {
  if (!_sharedReady || !_sharedWrites.stale() || _sharedScope.active()) return;
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
  function _write(_value9) {
    _selectedVersion++;
    _writes.mark();
    return _value9;
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
  const _nodes2 = _namespace2 === "svg" ? (() => {
    const _static2 = _document2.createTextNode("create1k");
    const _button = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button.append(_static2);
    const _static3 = _document2.createTextNode("create10k");
    const _button2 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button2.append(_static3);
    const _static4 = _document2.createTextNode("append1k");
    const _button3 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button3.append(_static4);
    const _static5 = _document2.createTextNode("prepend1k");
    const _button4 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button4.append(_static5);
    const _static6 = _document2.createTextNode("pop1k");
    const _button5 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button5.append(_static6);
    const _static7 = _document2.createTextNode("update");
    const _button6 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button6.append(_static7);
    const _static8 = _document2.createTextNode("swap");
    const _button7 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button7.append(_static8);
    const _static9 = _document2.createTextNode("reverse");
    const _button8 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button8.append(_static9);
    const _static10 = _document2.createTextNode("remove");
    const _button9 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button9.append(_static10);
    const _static11 = _document2.createTextNode("remove100");
    const _button10 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button10.append(_static11);
    const _static12 = _document2.createTextNode("clear");
    const _button11 = _document2.createElementNS("http://www.w3.org/2000/svg", "button");
    _button11.append(_static12);
    const _div = _document2.createElementNS("http://www.w3.org/2000/svg", "div");
    _div.setAttribute("class", "toolbar");
    _div.append(_button, _button2, _button3, _button4, _button5, _button6, _button7, _button8, _button9, _button10, _button11);
    const _slot5 = _document2.createComment("");
    const _ul = _document2.createElementNS("http://www.w3.org/2000/svg", "ul");
    _ul.append(_slot5);
    const _div2 = _document2.createElementNS("http://www.w3.org/2000/svg", "div");
    _div2.append(_div, _ul);
    return [_static2, _button, _static3, _button2, _static4, _button3, _static5, _button4, _static6, _button5, _static7, _button6, _static8, _button7, _static9, _button8, _static10, _button9, _static11, _button10, _static12, _button11, _div, _slot5, _ul, _div2];
  })() : _MD.materializeMarkup(_markup);
  const _button12 = _nodes2[1];
  const _button13 = _nodes2[3];
  const _button14 = _nodes2[5];
  const _button15 = _nodes2[7];
  const _button16 = _nodes2[9];
  const _button17 = _nodes2[11];
  const _button18 = _nodes2[13];
  const _button19 = _nodes2[15];
  const _button20 = _nodes2[17];
  const _button21 = _nodes2[19];
  const _button22 = _nodes2[21];
  const _slot6 = _nodes2[23];
  const _div3 = _nodes2[25];
  const _text5 = _document2.createTextNode("");
  _slot6.replaceWith(_text5);
  let _value10 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(1000);
    _write(selected = null);
  };
  let _listener3;
  if (_listener3 !== undefined) _button12.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value10 === "function") {
    _listener3 = _writes === null ? _value10 : _writes.listener(_value10);
    _button12.addEventListener("click", _listener3);
  }
  let _value11 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(10000);
    _write(selected = null);
  };
  let _listener4;
  if (_listener4 !== undefined) _button13.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value11 === "function") {
    _listener4 = _writes === null ? _value11 : _writes.listener(_value11);
    _button13.addEventListener("click", _listener4);
  }
  let _value12 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "concat", 0, void 0)(buildData(1000));
  };
  let _listener5;
  if (_listener5 !== undefined) _button14.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value12 === "function") {
    _listener5 = _writes === null ? _value12 : _writes.listener(_value12);
    _button14.addEventListener("click", _listener5);
  }
  let _value13 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_read_data());
  };
  let _listener6;
  if (_listener6 !== undefined) _button15.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value13 === "function") {
    _listener6 = _writes === null ? _value13 : _writes.listener(_value13);
    _button15.addEventListener("click", _listener6);
  }
  let _value14 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "slice", 0, void 0)(0, -1000);
  };
  let _listener7;
  if (_listener7 !== undefined) _button16.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value14 === "function") {
    _listener7 = _writes === null ? _value14 : _writes.listener(_value14);
    _button16.addEventListener("click", _listener7);
  }
  let _value15 = () => {
    for (let i = 0; i < _read_data().length; i += 10) _MD.mutationTarget(_read_data()[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener8;
  if (_listener8 !== undefined) _button17.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value15 === "function") {
    _listener8 = _writes === null ? _value15 : _writes.listener(_value15);
    _button17.addEventListener("click", _listener8);
  }
  let _value16 = () => {
    if (_read_data().length > 998) {
      const t = _read_data()[1];
      _MD.mutationTarget(_read_data(), 1, _mutated_data).value = _read_data()[998];
      _MD.mutationTarget(_read_data(), 998, _mutated_data).value = t;
    }
  };
  let _listener9;
  if (_listener9 !== undefined) _button18.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value16 === "function") {
    _listener9 = _writes === null ? _value16 : _writes.listener(_value16);
    _button18.addEventListener("click", _listener9);
  }
  let _value17 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "reverse", 0, void 0)();
  };
  let _listener10;
  if (_listener10 !== undefined) _button19.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value17 === "function") {
    _listener10 = _writes === null ? _value17 : _writes.listener(_value17);
    _button19.addEventListener("click", _listener10);
  }
  let _value18 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "splice", 0, void 0)(500, 1);
  };
  let _listener11;
  if (_listener11 !== undefined) _button20.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value18 === "function") {
    _listener11 = _writes === null ? _value18 : _writes.listener(_value18);
    _button20.addEventListener("click", _listener11);
  }
  let _value19 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "filter", 1, void 0)((_item, index) => index % 100 !== 0);
  };
  let _listener12;
  if (_listener12 !== undefined) _button21.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value19 === "function") {
    _listener12 = _writes === null ? _value19 : _writes.listener(_value19);
    _button21.addEventListener("click", _listener12);
  }
  let _value20 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = [];
    _write(selected = null);
  };
  let _listener13;
  if (_listener13 !== undefined) _button22.removeEventListener("click", _listener13);
  _listener13 = undefined;
  if (typeof _value20 === "function") {
    _listener13 = _writes === null ? _value20 : _writes.listener(_value20);
    _button22.addEventListener("click", _listener13);
  }
  const _rowNamespace = _MD.renderNamespace(_text5.parentNode, _namespace2);
  const _rowList = _MD.createRowList(_text5, { id: _id, batch: _writes, entity: _entity, namespace: _namespace2 }, (item) => item.id, (item) => {
    if (_rowNamespace === "svg") {
      const _slot7 = _document2.createComment("");
      const _static13 = _document2.createTextNode(": ");
      const _slot8 = _document2.createComment("");
      const _li3 = _document2.createElementNS("http://www.w3.org/2000/svg", "li");
      _li3.append(_slot7, _static13, _slot8);
      const _text6 = _document2.createTextNode("");
      _slot7.replaceWith(_text6);
      const _text7 = _document2.createTextNode("");
      _slot8.replaceWith(_text7);
      let _value22 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '';
      if (_value22 != null && _value22 !== false) {
        _li3.setAttribute("class", _value22 === true ? "" : _MD.textValue(_value22));
      } else {
        _li3.removeAttribute("class");
      }
      let _value23 = () => {
        _write(selected = item.id);
      };
      let _listener14;
      if (_listener14 !== undefined) _li3.removeEventListener("click", _listener14);
      _listener14 = undefined;
      if (typeof _value23 === "function") {
        _listener14 = _writes === null ? _value23 : _writes.listener(_value23);
        _li3.addEventListener("click", _listener14);
      }
      let _value24 = item.id;
      let _valueSlot5 = null;
      if (_valueSlot5 === null && (_value24 === null || typeof _value24 !== "object")) {
        _MD.setTextData(_text6, _value24);
      } else {
        (_valueSlot5 ??= _MD.createIndexedValueSlot(_text6, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value24);
      }
      let _value25 = item.label;
      let _valueSlot6 = null;
      if (_valueSlot6 === null && (_value25 === null || typeof _value25 !== "object")) {
        _MD.setTextData(_text7, _value25);
      } else {
        (_valueSlot6 ??= _MD.createIndexedValueSlot(_text7, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value25);
      }
      return { node: _li3, update(_item2) {
        item = _item2;
        const _next9 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '';
        if (_next9 !== _value22 && !(_next9 !== _next9 && _value22 !== _value22)) {
          if (_next9 != null && _next9 !== false) {
            _li3.setAttribute("class", _next9 === true ? "" : _MD.textValue(_next9));
          } else {
            _li3.removeAttribute("class");
          }
          _value22 = _next9;
        }
        const _next10 = item.id;
        if (_next10 !== _value24 && !(_next10 !== _next10 && _value24 !== _value24)) {
          if (_valueSlot5 === null && (_next10 === null || typeof _next10 !== "object")) {
            _MD.setTextData(_text6, _next10);
          } else {
            (_valueSlot5 ??= _MD.createIndexedValueSlot(_text6, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next10);
          }
          _value24 = _next10;
        }
        const _next11 = item.label;
        if (_next11 !== _value25 && !(_next11 !== _next11 && _value25 !== _value25)) {
          if (_valueSlot6 === null && (_next11 === null || typeof _next11 !== "object")) {
            _MD.setTextData(_text7, _next11);
          } else {
            (_valueSlot6 ??= _MD.createIndexedValueSlot(_text7, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next11);
          }
          _value25 = _next11;
        }
      }, dispose() {
        if (_valueSlot5 !== null) _valueSlot5.dispose();
        _valueSlot5 = _MD.disposedValueSlot;
        if (_valueSlot6 !== null) _valueSlot6.dispose();
        _valueSlot6 = _MD.disposedValueSlot;
      } };
    }
    const _rowMarkup = "<li><!---->: <!----></li>";
    const _nodes3 = _MD.materializeMarkup(_rowMarkup);
    const _slot9 = _nodes3[0];
    const _slot10 = _nodes3[2];
    const _li4 = _nodes3[3];
    const _text8 = _document2.createTextNode("");
    _slot9.replaceWith(_text8);
    const _text9 = _document2.createTextNode("");
    _slot10.replaceWith(_text9);
    let _value26 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '';
    if (_value26 != null && _value26 !== false) {
      _li4.setAttribute("class", _value26 === true ? "" : _MD.textValue(_value26));
    } else {
      _li4.removeAttribute("class");
    }
    let _value27 = () => {
      _write(selected = item.id);
    };
    let _listener15;
    if (_listener15 !== undefined) _li4.removeEventListener("click", _listener15);
    _listener15 = undefined;
    if (typeof _value27 === "function") {
      _listener15 = _writes === null ? _value27 : _writes.listener(_value27);
      _li4.addEventListener("click", _listener15);
    }
    let _value28 = item.id;
    let _valueSlot7 = null;
    if (_valueSlot7 === null && (_value28 === null || typeof _value28 !== "object")) {
      _MD.setTextData(_text8, _value28);
    } else {
      (_valueSlot7 ??= _MD.createIndexedValueSlot(_text8, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value28);
    }
    let _value29 = item.label;
    let _valueSlot8 = null;
    if (_valueSlot8 === null && (_value29 === null || typeof _value29 !== "object")) {
      _MD.setTextData(_text9, _value29);
    } else {
      (_valueSlot8 ??= _MD.createIndexedValueSlot(_text9, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_value29);
    }
    return { node: _li4, update(_item3) {
      item = _item3;
      const _next12 = _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '';
      if (_next12 !== _value26 && !(_next12 !== _next12 && _value26 !== _value26)) {
        if (_next12 != null && _next12 !== false) {
          _li4.setAttribute("class", _next12 === true ? "" : _MD.textValue(_next12));
        } else {
          _li4.removeAttribute("class");
        }
        _value26 = _next12;
      }
      const _next13 = item.id;
      if (_next13 !== _value28 && !(_next13 !== _next13 && _value28 !== _value28)) {
        if (_valueSlot7 === null && (_next13 === null || typeof _next13 !== "object")) {
          _MD.setTextData(_text8, _next13);
        } else {
          (_valueSlot7 ??= _MD.createIndexedValueSlot(_text8, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next13);
        }
        _value28 = _next13;
      }
      const _next14 = item.label;
      if (_next14 !== _value29 && !(_next14 !== _next14 && _value29 !== _value29)) {
        if (_valueSlot8 === null && (_next14 === null || typeof _next14 !== "object")) {
          _MD.setTextData(_text9, _next14);
        } else {
          (_valueSlot8 ??= _MD.createIndexedValueSlot(_text9, { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace })).write(_next14);
        }
        _value29 = _next14;
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
  let _value21 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createKeyedRenderValue(_renderProgram, [item.id, _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '', () => {
    _write(selected = item.id);
  }, item.id, item.label], 0)));
  _siteComputation.end();
  _rowList.write(_value21);
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
    if (_siteComputation.changed()) {
      _siteComputation.begin();
      const _next15 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createKeyedRenderValue(_renderProgram, [item.id, _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey) ? 'danger' : '', () => {
        _write(selected = item.id);
      }, item.id, item.label], 0)));
      _siteComputation.end();
      if (_next15 !== _value21 && !(_next15 !== _next15 && _value21 !== _value21)) {
        _rowList.write(_next15);
        _value21 = _next15;
      }
    }
    if (_publishedVersion !== _selectedVersion) {
      _publishedVersion = _selectedVersion;
      _MD.publishVersions([_readKey]);
    }
    _MD.checkMutationRoots(_entity);
    _scope.leave(_updateFrame);
  }
  _writes.activate();
  _scope.leave(_setupFrame);
  return _div3;
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
