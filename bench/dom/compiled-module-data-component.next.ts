/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
const _markup = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul><!----></ul></div>";
_MD.defineComponent(BenchModuleDataComponent, "./bench/dom/AppModuleDataComponent.tsx#BenchModuleDataComponent");
const _markup2 = "<li><!---->: <!----></li>";
_MD.defineComponent(Row, "./bench/dom/AppModuleDataComponent.tsx#Row");
let _dataVersion = 0;
const _sharedKey = {};
function _read_data() {
  if (_MD.isBuilding() && _sharedReady && !_sharedScope.active()) _refreshShared();
  return _MD.trackRead(() => {
    if (_MD.isBuilding() && _sharedReady && !_sharedScope.active()) _refreshShared();
    return _dataVersion;
  }, data, _sharedKey);
}
export { _read_data };
const _sharedScope = _MD.createBuildScope(true, false);
let _sharedReady = false;
const _sharedWrites = _MD.createSharedWrites([_sharedKey], []);
function _mutated_data() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
const _rows = _MD.createRowCache(false);
function _completeShared(_result) {
  _sharedReady = true;
  _sharedScope.leave(_sharedFrame);
  return _result;
}
function _refreshShared() {
  if (!_sharedReady || _sharedScope.active()) return;
  const _sharedFrame = _sharedScope.enter();
  _sharedWrites.check();
  _sharedScope.leave(_sharedFrame);
}
const _sharedFrame = _sharedScope.enter();
import { buildData } from './data';
let data = [];
_sharedWrites.watch([{ read: () => data, notify: () => {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
} }]);
function Row(_id2, _parent2, _props2, _namespace2, _setupOnly2) {
  let _propsVersion = 0;
  const _readKey2 = {};
  function _mutated_props() {
    _propsVersion++;
    _writes2.mark();
  }
  const _entity2 = { id: _id2, parent: _parent2, render: _update2 };
  const _writes2 = _MD.createWriteBatch(_entity2);
  _MD.registerEntity(_entity2);
  const _scope2 = _MD.createBuildScope();
  const _setupFrame2 = _scope2.enter(() => {
    if (_MD.getEntity(_id2) === _entity2) {
      _MD.unregisterSubtree(_id2);
    }
  });
  const _propsCell2 = _props2 ?? _MD.createPropsCell({});
  let props = _propsCell2.arguments[0];
  let _propsParent = props;
  let _propsSeen = _MD.mutationTime();
  _propsCell2.receive = (_incomingProps2) => {
    const _propsProp = _propsCell2.arguments[0];
    let _propsChanged = false;
    if (!_MD.sameValue(_propsProp, _propsParent)) {
      props = _propsProp;
      _propsParent = _propsProp;
      _propsVersion++;
      _propsChanged = true;
    } else if (_MD.mutatedSince(_propsParent, _propsSeen)) {
      _propsVersion++;
      _propsChanged = true;
    }
    _propsSeen = _MD.mutationTime();
    if (_propsChanged) _writes2.mark();
  };
  if (_setupOnly2) {
    _scope2.leave(_setupFrame2);
    return;
  }
  _writes2.beginMount();
  const _document2 = _MD.getActiveEnvironment().document;
  const _nodes2 = _namespace2 === "svg" ? (() => {
    const _slot3 = _document2.createComment("");
    const _static12 = _document2.createTextNode(": ");
    const _slot4 = _document2.createComment("");
    const _li = _document2.createElementNS("http://www.w3.org/2000/svg", "li");
    _li.append(_slot3, _static12, _slot4);
    return [_slot3, _static12, _slot4, _li];
  })() : _MD.materializeMarkup(_markup2);
  const _slot5 = _nodes2[0];
  const _slot6 = _nodes2[2];
  const _li2 = _nodes2[3];
  const _text2 = _document2.createTextNode("");
  _slot5.replaceWith(_text2);
  const _text3 = _document2.createTextNode("");
  _slot6.replaceWith(_text3);
  const _siteComputation2 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation2.begin();
  let _value14 = props.selected ? 'danger' : '';
  _siteComputation2.end();
  if (_value14 != null && _value14 !== false) {
    _li2.setAttribute("class", _value14 === true ? "" : _MD.textValue(_value14));
  } else {
    _li2.removeAttribute("class");
  }
  let _seen = _propsVersion;
  let _value15 = () => {
    _MD.observeMethod([() => props], [_mutated_props], _MD.trackRead(() => _propsVersion, props, _readKey2), "select", 0, void 0)(_MD.trackRead(() => _propsVersion, props, _readKey2).item.id);
  };
  let _listener12;
  if (_listener12 !== undefined) _li2.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value15 === "function") {
    _listener12 = _writes2 === null ? _value15 : _writes2.listener(_value15);
    _li2.addEventListener("click", _listener12);
  }
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _value16 = props.item.id;
  _siteComputation3.end();
  let _valueSlot2 = null;
  if (_valueSlot2 === null && (_value16 === null || typeof _value16 !== "object")) {
    _MD.setTextData(_text2, _value16);
  } else {
    (_valueSlot2 ??= _MD.createIndexedValueSlot(_text2, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_value16);
  }
  let _seen2 = _propsVersion;
  const _siteComputation4 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation4.begin();
  let _value17 = props.item.label;
  _siteComputation4.end();
  let _valueSlot3 = null;
  if (_valueSlot3 === null && (_value17 === null || typeof _value17 !== "object")) {
    _MD.setTextData(_text3, _value17);
  } else {
    (_valueSlot3 ??= _MD.createIndexedValueSlot(_text3, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_value17);
  }
  let _seen3 = _propsVersion;
  let _publishedVersion2 = _propsVersion;
  _MD.cleanup(_id2, () => {
    _siteComputation2.dispose();
    _siteComputation3.dispose();
    if (_valueSlot2 !== null) _valueSlot2.dispose();
    _valueSlot2 = _MD.disposedValueSlot;
    _siteComputation4.dispose();
    if (_valueSlot3 !== null) _valueSlot3.dispose();
    _valueSlot3 = _MD.disposedValueSlot;
  });
  function _update2() {
    const _updateFrame2 = _scope2.enter();
    if (_propsVersion !== _seen || _siteComputation2.changed()) {
      _siteComputation2.begin();
      const _next2 = props.selected ? 'danger' : '';
      _siteComputation2.end();
      if (_next2 !== _value14 && !(_next2 !== _next2 && _value14 !== _value14)) {
        if (_next2 != null && _next2 !== false) {
          _li2.setAttribute("class", _next2 === true ? "" : _MD.textValue(_next2));
        } else {
          _li2.removeAttribute("class");
        }
        _value14 = _next2;
      }
      _seen = _propsVersion;
    }
    if (_propsVersion !== _seen2 || _siteComputation3.changed()) {
      _siteComputation3.begin();
      const _next3 = props.item.id;
      _siteComputation3.end();
      if (_next3 !== _value16 && !(_next3 !== _next3 && _value16 !== _value16)) {
        if (_valueSlot2 === null && (_next3 === null || typeof _next3 !== "object")) {
          _MD.setTextData(_text2, _next3);
        } else {
          (_valueSlot2 ??= _MD.createIndexedValueSlot(_text2, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_next3);
        }
        _value16 = _next3;
      }
      _seen2 = _propsVersion;
    }
    if (_propsVersion !== _seen3 || _siteComputation4.changed()) {
      _siteComputation4.begin();
      const _next4 = props.item.label;
      _siteComputation4.end();
      if (_next4 !== _value17 && !(_next4 !== _next4 && _value17 !== _value17)) {
        if (_valueSlot3 === null && (_next4 === null || typeof _next4 !== "object")) {
          _MD.setTextData(_text3, _next4);
        } else {
          (_valueSlot3 ??= _MD.createIndexedValueSlot(_text3, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_next4);
        }
        _value17 = _next4;
      }
      _seen3 = _propsVersion;
    }
    if (_publishedVersion2 !== _propsVersion) {
      _publishedVersion2 = _propsVersion;
      _MD.publishVersions([_readKey2]);
    }
    _scope2.leave(_updateFrame2);
  }
  _writes2.activate();
  _scope2.leave(_setupFrame2);
  return _li2;
}
export function BenchModuleDataComponent(_id, _parent, _props, _namespace, _setupOnly) {
  let _selectedVersion = 0;
  let _selectVersion = 0;
  const _readKey = {};
  function _write(_value) {
    _selectedVersion++;
    _writes.mark();
    return _value;
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
  const select = (id) => {
    _write(selected = id);
  };
  if (_setupOnly) {
    _scope.leave(_setupFrame);
    return;
  }
  _writes.beginMount();
  const _document = _MD.getActiveEnvironment().document;
  const _nodes = _namespace === "svg" ? (() => {
    const _static = _document.createTextNode("create1k");
    const _button = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button.append(_static);
    const _static2 = _document.createTextNode("create10k");
    const _button2 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button2.append(_static2);
    const _static3 = _document.createTextNode("append1k");
    const _button3 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button3.append(_static3);
    const _static4 = _document.createTextNode("prepend1k");
    const _button4 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button4.append(_static4);
    const _static5 = _document.createTextNode("pop1k");
    const _button5 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button5.append(_static5);
    const _static6 = _document.createTextNode("update");
    const _button6 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button6.append(_static6);
    const _static7 = _document.createTextNode("swap");
    const _button7 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button7.append(_static7);
    const _static8 = _document.createTextNode("reverse");
    const _button8 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button8.append(_static8);
    const _static9 = _document.createTextNode("remove");
    const _button9 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button9.append(_static9);
    const _static10 = _document.createTextNode("remove100");
    const _button10 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button10.append(_static10);
    const _static11 = _document.createTextNode("clear");
    const _button11 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
    _button11.append(_static11);
    const _div = _document.createElementNS("http://www.w3.org/2000/svg", "div");
    _div.setAttribute("class", "toolbar");
    _div.append(_button, _button2, _button3, _button4, _button5, _button6, _button7, _button8, _button9, _button10, _button11);
    const _slot = _document.createComment("");
    const _ul = _document.createElementNS("http://www.w3.org/2000/svg", "ul");
    _ul.append(_slot);
    const _div2 = _document.createElementNS("http://www.w3.org/2000/svg", "div");
    _div2.append(_div, _ul);
    return [_static, _button, _static2, _button2, _static3, _button3, _static4, _button4, _static5, _button5, _static6, _button6, _static7, _button7, _static8, _button8, _static9, _button9, _static10, _button10, _static11, _button11, _div, _slot, _ul, _div2];
  })() : _MD.materializeMarkup(_markup);
  const _button12 = _nodes[1];
  const _button13 = _nodes[3];
  const _button14 = _nodes[5];
  const _button15 = _nodes[7];
  const _button16 = _nodes[9];
  const _button17 = _nodes[11];
  const _button18 = _nodes[13];
  const _button19 = _nodes[15];
  const _button20 = _nodes[17];
  const _button21 = _nodes[19];
  const _button22 = _nodes[21];
  const _slot2 = _nodes[23];
  const _div3 = _nodes[25];
  const _text = _document.createTextNode("");
  _slot2.replaceWith(_text);
  let _value2 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(1000);
    _write(selected = null);
  };
  let _listener;
  if (_listener !== undefined) _button12.removeEventListener("click", _listener);
  _listener = undefined;
  if (typeof _value2 === "function") {
    _listener = _writes === null ? _value2 : _writes.listener(_value2);
    _button12.addEventListener("click", _listener);
  }
  let _value3 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(10000);
    _write(selected = null);
  };
  let _listener2;
  if (_listener2 !== undefined) _button13.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value3 === "function") {
    _listener2 = _writes === null ? _value3 : _writes.listener(_value3);
    _button13.addEventListener("click", _listener2);
  }
  let _value4 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "concat", 0, void 0)(buildData(1000));
  };
  let _listener3;
  if (_listener3 !== undefined) _button14.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value4 === "function") {
    _listener3 = _writes === null ? _value4 : _writes.listener(_value4);
    _button14.addEventListener("click", _listener3);
  }
  let _value5 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_read_data());
  };
  let _listener4;
  if (_listener4 !== undefined) _button15.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value5 === "function") {
    _listener4 = _writes === null ? _value5 : _writes.listener(_value5);
    _button15.addEventListener("click", _listener4);
  }
  let _value6 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "slice", 0, void 0)(0, -1000);
  };
  let _listener5;
  if (_listener5 !== undefined) _button16.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value6 === "function") {
    _listener5 = _writes === null ? _value6 : _writes.listener(_value6);
    _button16.addEventListener("click", _listener5);
  }
  let _value7 = () => {
    for (let i = 0; i < _read_data().length; i += 10) _MD.mutationTarget(_read_data()[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener6;
  if (_listener6 !== undefined) _button17.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value7 === "function") {
    _listener6 = _writes === null ? _value7 : _writes.listener(_value7);
    _button17.addEventListener("click", _listener6);
  }
  let _value8 = () => {
    if (_read_data().length > 998) {
      const t = _read_data()[1];
      _MD.mutationTarget(_read_data(), 1, _mutated_data).value = _read_data()[998];
      _MD.mutationTarget(_read_data(), 998, _mutated_data).value = t;
    }
  };
  let _listener7;
  if (_listener7 !== undefined) _button18.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value8 === "function") {
    _listener7 = _writes === null ? _value8 : _writes.listener(_value8);
    _button18.addEventListener("click", _listener7);
  }
  let _value9 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "reverse", 0, void 0)();
  };
  let _listener8;
  if (_listener8 !== undefined) _button19.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value9 === "function") {
    _listener8 = _writes === null ? _value9 : _writes.listener(_value9);
    _button19.addEventListener("click", _listener8);
  }
  let _value10 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "splice", 0, void 0)(500, 1);
  };
  let _listener9;
  if (_listener9 !== undefined) _button20.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value10 === "function") {
    _listener9 = _writes === null ? _value10 : _writes.listener(_value10);
    _button20.addEventListener("click", _listener9);
  }
  let _value11 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "filter", 1, void 0)((_item, index) => index % 100 !== 0);
  };
  let _listener10;
  if (_listener10 !== undefined) _button21.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value11 === "function") {
    _listener10 = _writes === null ? _value11 : _writes.listener(_value11);
    _button21.addEventListener("click", _listener10);
  }
  let _value12 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = [];
    _write(selected = null);
  };
  let _listener11;
  if (_listener11 !== undefined) _button22.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value12 === "function") {
    _listener11 = _writes === null ? _value12 : _writes.listener(_value12);
    _button22.addEventListener("click", _listener11);
  }
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  let _value13 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rows)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey), "select": select })));
  _siteComputation.end();
  let _valueSlot = null;
  if (_valueSlot === null && (_value13 === null || typeof _value13 !== "object")) {
    _MD.setTextData(_text, _value13);
  } else {
    (_valueSlot ??= _MD.createIndexedValueSlot(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace })).write(_value13);
  }
  let _publishedVersion = _selectedVersion;
  _MD.cleanup(_id, () => {
    _siteComputation.dispose();
    if (_valueSlot !== null) _valueSlot.dispose();
    _valueSlot = _MD.disposedValueSlot;
  });
  _MD.watchMutationRoots(_entity, [{ read: () => selected, notify: () => {
    _selectedVersion++;
    if (!_scope.building()) _writes.mark();
  } }, { read: () => select, notify: () => {
    _selectVersion++;
    if (!_scope.building()) _writes.mark();
  } }]);
  function _update() {
    const _updateFrame = _scope.enter();
    if (_siteComputation.changed()) {
      _siteComputation.begin();
      const _next = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rows)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey), "select": select })));
      _siteComputation.end();
      if (_next !== _value13 && !(_next !== _next && _value13 !== _value13)) {
        if (_valueSlot === null && (_next === null || typeof _next !== "object")) {
          _MD.setTextData(_text, _next);
        } else {
          (_valueSlot ??= _MD.createIndexedValueSlot(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace })).write(_next);
        }
        _value13 = _next;
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

export function createModuleDataComponent() {
  const root = BenchModuleDataComponent('BenchModuleDataComponent', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppModuleDataComponent`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
