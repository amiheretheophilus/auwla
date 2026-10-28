/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchApp, "./bench/dom/App.tsx#BenchApp");
_MD.defineComponent(Row, "./bench/dom/App.tsx#Row");
function _Row_row(props, _rowOwner2) {
  const _document2 = _MD.getActiveEnvironment().document;
  const _rowId = _rowOwner2.id;
  const _rowWrites = _rowOwner2.batch;
  const _rowEntity = _rowOwner2.entity;
  const _rowNamespace2 = _rowOwner2.namespace;
  const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace2);
  const _text2 = _clone2.firstChild;
  const _node3 = _text2.nextSibling;
  const _text3 = _node3.nextSibling;
  let _value13 = _peek_selected() === props.item.id ? 'danger' : '';
  if (_value13 != null && _value13 !== false) {
    _clone2.setAttribute("class", _value13 === true ? "" : _MD.textValue(_value13));
  } else {
    _clone2.removeAttribute("class");
  }
  let _value14 = () => {
    ({ get value() {
      return selected;
    }, set value(_assigned2) {
      selected = _assigned2;
      _selectedVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey2);
    } }).value = props.item.id;
  };
  let _listener12;
  if (_listener12 !== undefined) _clone2.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value14 === "function") {
    _listener12 = _rowWrites === null ? _value14 : _rowWrites.listener(_value14);
    _clone2.addEventListener("click", _listener12);
  }
  let _value15 = props.item.id;
  let _valueSlot = null;
  if (_valueSlot === null && (_value15 === null || typeof _value15 !== "object")) {
    _MD.setTextData(_text2, _value15);
  } else {
    (_valueSlot ??= _MD.createIndexedValueSlot(_text2, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_value15);
  }
  let _value16 = props.item.label;
  let _valueSlot2 = null;
  if (_valueSlot2 === null && (_value16 === null || typeof _value16 !== "object")) {
    _MD.setTextData(_text3, _value16);
  } else {
    (_valueSlot2 ??= _MD.createIndexedValueSlot(_text3, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_value16);
  }
  return { node: _clone2, update(_nextProps) {
    props = _nextProps;
    const _next = _peek_selected() === props.item.id ? 'danger' : '';
    if (_next !== _value13 && !(_next !== _next && _value13 !== _value13)) {
      if (_next != null && _next !== false) {
        _clone2.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
      } else {
        _clone2.removeAttribute("class");
      }
      _value13 = _next;
    }
    const _next2 = props.item.id;
    if (_next2 !== _value15 && !(_next2 !== _next2 && _value15 !== _value15)) {
      if (_valueSlot === null && (_next2 === null || typeof _next2 !== "object")) {
        _MD.setTextData(_text2, _next2);
      } else {
        (_valueSlot ??= _MD.createIndexedValueSlot(_text2, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_next2);
      }
      _value15 = _next2;
    }
    const _next3 = props.item.label;
    if (_next3 !== _value16 && !(_next3 !== _next3 && _value16 !== _value16)) {
      if (_valueSlot2 === null && (_next3 === null || typeof _next3 !== "object")) {
        _MD.setTextData(_text3, _next3);
      } else {
        (_valueSlot2 ??= _MD.createIndexedValueSlot(_text3, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_next3);
      }
      _value16 = _next3;
    }
  }, dispose() {
    if (_valueSlot !== null) _valueSlot.dispose();
    _valueSlot = _MD.disposedValueSlot;
    if (_valueSlot2 !== null) _valueSlot2.dispose();
    _valueSlot2 = _MD.disposedValueSlot;
  } };
}
const _template = _MD.createTemplateCache([["div", 0, ["div", ["class", "toolbar"], ["button", 0, "create1k"], ["button", 0, "create10k"], ["button", 0, "append1k"], ["button", 0, "prepend1k"], ["button", 0, "pop1k"], ["button", 0, "update"], ["button", 0, "swap"], ["button", 0, "reverse"], ["button", 0, "remove"], ["button", 0, "remove100"], ["button", 0, "clear"]], ["ul", 0, ""]]]);
const _template2 = _MD.createTemplateCache([["li", 0, "", ": ", ""]]);
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
let _selectedVersion = 0;
const _sharedKey2 = {};
function _mutated_selected() {
  _selectedVersion++;
  _sharedWrites.mark(_sharedKey2);
}
function _version_selected() {
  if (_MD.isBuilding()) _refreshShared();
  return _selectedVersion;
}
function _read_selected() {
  if (_MD.isBuilding()) _refreshShared();
  return _MD.trackRead(_version_selected, selected, _sharedKey2);
}
export { _read_selected };
function _peek_selected() {
  if (_MD.isBuilding()) _refreshShared();
  return selected;
}
const _sharedScope = _MD.createBuildScope(true, false);
const _effectInvocation = _MD.isEffectInvocation();
let _sharedReady = false;
const _sharedWrites = _MD.createSharedWrites([_sharedKey, _sharedKey2], []);
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
let selected = null;
_sharedWrites.watch([{ read: () => selected, notify: _mutated_selected }]);
function Row(_id2, _parent2, _props2, _namespace2, _setupOnly2) {
  let _propsVersion = 0;
  const _readKey = {};
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
  const _document3 = _MD.getActiveEnvironment().document;
  const _clone3 = _MD.cloneTemplate(_template3, _namespace2);
  const _text4 = _clone3.firstChild;
  const _node4 = _text4.nextSibling;
  const _text5 = _node4.nextSibling;
  const _siteComputation2 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation2.begin();
  let _value17 = _MD.trackEquals(_peek_selected(), props.item.id, _peek_selected, _version_selected, _sharedKey2) ? 'danger' : '';
  _siteComputation2.end();
  if (_value17 != null && _value17 !== false) {
    _clone3.setAttribute("class", _value17 === true ? "" : _MD.textValue(_value17));
  } else {
    _clone3.removeAttribute("class");
  }
  let _seen = _propsVersion;
  let _value18 = () => {
    ({ get value() {
      return selected;
    }, set value(_assigned2) {
      selected = _assigned2;
      _selectedVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey2);
    } }).value = _MD.trackRead(() => _propsVersion, props, _readKey).item.id;
  };
  let _listener13;
  if (_listener13 !== undefined) _clone3.removeEventListener("click", _listener13);
  _listener13 = undefined;
  if (typeof _value18 === "function") {
    _listener13 = _writes2 === null ? _value18 : _writes2.listener(_value18);
    _clone3.addEventListener("click", _listener13);
  }
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _value19 = props.item.id;
  _siteComputation3.end();
  let _valueSlot3 = null;
  if (_valueSlot3 === null && (_value19 === null || typeof _value19 !== "object")) {
    _MD.setTextData(_text4, _value19);
  } else {
    (_valueSlot3 ??= _MD.createIndexedValueSlot(_text4, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_value19);
  }
  let _seen2 = _propsVersion;
  const _siteComputation4 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation4.begin();
  let _value20 = props.item.label;
  _siteComputation4.end();
  let _valueSlot4 = null;
  if (_valueSlot4 === null && (_value20 === null || typeof _value20 !== "object")) {
    _MD.setTextData(_text5, _value20);
  } else {
    (_valueSlot4 ??= _MD.createIndexedValueSlot(_text5, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_value20);
  }
  let _seen3 = _propsVersion;
  let _publishedVersion = _propsVersion;
  _MD.cleanup(_id2, () => {
    _siteComputation2.dispose();
    _siteComputation3.dispose();
    if (_valueSlot3 !== null) _valueSlot3.dispose();
    _valueSlot3 = _MD.disposedValueSlot;
    _siteComputation4.dispose();
    if (_valueSlot4 !== null) _valueSlot4.dispose();
    _valueSlot4 = _MD.disposedValueSlot;
  });
  function _update2() {
    const _updateFrame2 = _scope2.enter();
    if (_propsVersion !== _seen || _siteComputation2.changed()) {
      _siteComputation2.begin();
      const _next5 = _MD.trackEquals(_peek_selected(), props.item.id, _peek_selected, _version_selected, _sharedKey2) ? 'danger' : '';
      _siteComputation2.end();
      if (_next5 !== _value17 && !(_next5 !== _next5 && _value17 !== _value17)) {
        if (_next5 != null && _next5 !== false) {
          _clone3.setAttribute("class", _next5 === true ? "" : _MD.textValue(_next5));
        } else {
          _clone3.removeAttribute("class");
        }
        _value17 = _next5;
      }
      _seen = _propsVersion;
    }
    if (_propsVersion !== _seen2 || _siteComputation3.changed()) {
      _siteComputation3.begin();
      const _next6 = props.item.id;
      _siteComputation3.end();
      if (_next6 !== _value19 && !(_next6 !== _next6 && _value19 !== _value19)) {
        if (_valueSlot3 === null && (_next6 === null || typeof _next6 !== "object")) {
          _MD.setTextData(_text4, _next6);
        } else {
          (_valueSlot3 ??= _MD.createIndexedValueSlot(_text4, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_next6);
        }
        _value19 = _next6;
      }
      _seen2 = _propsVersion;
    }
    if (_propsVersion !== _seen3 || _siteComputation4.changed()) {
      _siteComputation4.begin();
      const _next7 = props.item.label;
      _siteComputation4.end();
      if (_next7 !== _value20 && !(_next7 !== _next7 && _value20 !== _value20)) {
        if (_valueSlot4 === null && (_next7 === null || typeof _next7 !== "object")) {
          _MD.setTextData(_text5, _next7);
        } else {
          (_valueSlot4 ??= _MD.createIndexedValueSlot(_text5, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_next7);
        }
        _value20 = _next7;
      }
      _seen3 = _propsVersion;
    }
    if (_publishedVersion !== _propsVersion) {
      _publishedVersion = _propsVersion;
      _MD.publishVersions([_readKey]);
    }
    _scope2.leave(_updateFrame2);
  }
  _writes2.activate();
  _scope2.leave(_setupFrame2);
  return _clone3;
}
export function BenchApp(_id, _parent, _props, _namespace, _setupOnly) {
  const _entity = { id: _id, parent: _parent, render: _update };
  const _writes = _MD.createWriteBatch(_entity);
  _MD.registerEntity(_entity);
  const _scope = _MD.createBuildScope();
  const _setupFrame = _scope.enter(() => {
    if (_MD.getEntity(_id) === _entity) {
      _MD.unregisterSubtree(_id);
    }
  });
  if (_setupOnly) {
    _scope.leave(_setupFrame);
    return;
  }
  _writes.beginMount();
  const _document = _MD.getActiveEnvironment().document;
  const _clone = _MD.cloneTemplate(_template, _namespace);
  const _node = _clone.firstChild;
  const _button = _node.firstChild;
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
  const _node2 = _node.nextSibling;
  const _text = _node2.firstChild;
  let _value = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(1000);
    ({ get value() {
      return selected;
    }, set value(_assigned2) {
      selected = _assigned2;
      _selectedVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey2);
    } }).value = null;
  };
  let _listener;
  if (_listener !== undefined) _button.removeEventListener("click", _listener);
  _listener = undefined;
  if (typeof _value === "function") {
    _listener = _writes === null ? _value : _writes.listener(_value);
    _button.addEventListener("click", _listener);
  }
  let _value2 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(10000);
    ({ get value() {
      return selected;
    }, set value(_assigned2) {
      selected = _assigned2;
      _selectedVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey2);
    } }).value = null;
  };
  let _listener2;
  if (_listener2 !== undefined) _button2.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value2 === "function") {
    _listener2 = _writes === null ? _value2 : _writes.listener(_value2);
    _button2.addEventListener("click", _listener2);
  }
  let _value3 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "concat", 0, void 0)(buildData(1000));
  };
  let _listener3;
  if (_listener3 !== undefined) _button3.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value3 === "function") {
    _listener3 = _writes === null ? _value3 : _writes.listener(_value3);
    _button3.addEventListener("click", _listener3);
  }
  let _value4 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_read_data());
  };
  let _listener4;
  if (_listener4 !== undefined) _button4.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value4 === "function") {
    _listener4 = _writes === null ? _value4 : _writes.listener(_value4);
    _button4.addEventListener("click", _listener4);
  }
  let _value5 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "slice", 0, void 0)(0, -1000);
  };
  let _listener5;
  if (_listener5 !== undefined) _button5.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value5 === "function") {
    _listener5 = _writes === null ? _value5 : _writes.listener(_value5);
    _button5.addEventListener("click", _listener5);
  }
  let _value6 = () => {
    for (let i = 0; i < _read_data().length; i += 10) _MD.mutationTarget(_read_data()[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener6;
  if (_listener6 !== undefined) _button6.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value6 === "function") {
    _listener6 = _writes === null ? _value6 : _writes.listener(_value6);
    _button6.addEventListener("click", _listener6);
  }
  let _value7 = () => {
    if (_read_data().length > 998) {
      const t = _read_data()[1];
      _MD.mutationTarget(_read_data(), 1, _mutated_data).value = _read_data()[998];
      _MD.mutationTarget(_read_data(), 998, _mutated_data).value = t;
    }
  };
  let _listener7;
  if (_listener7 !== undefined) _button7.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value7 === "function") {
    _listener7 = _writes === null ? _value7 : _writes.listener(_value7);
    _button7.addEventListener("click", _listener7);
  }
  let _value8 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "reverse", 0, void 0)();
  };
  let _listener8;
  if (_listener8 !== undefined) _button8.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value8 === "function") {
    _listener8 = _writes === null ? _value8 : _writes.listener(_value8);
    _button8.addEventListener("click", _listener8);
  }
  let _value9 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "splice", 0, void 0)(500, 1);
  };
  let _listener9;
  if (_listener9 !== undefined) _button9.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value9 === "function") {
    _listener9 = _writes === null ? _value9 : _writes.listener(_value9);
    _button9.addEventListener("click", _listener9);
  }
  let _value10 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "filter", 1, void 0)((_item, index) => index % 100 !== 0);
  };
  let _listener10;
  if (_listener10 !== undefined) _button10.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value10 === "function") {
    _listener10 = _writes === null ? _value10 : _writes.listener(_value10);
    _button10.addEventListener("click", _listener10);
  }
  let _value11 = () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = [];
    ({ get value() {
      return selected;
    }, set value(_assigned2) {
      selected = _assigned2;
      _selectedVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey2);
    } }).value = null;
  };
  let _listener11;
  if (_listener11 !== undefined) _button11.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value11 === "function") {
    _listener11 = _writes === null ? _value11 : _writes.listener(_value11);
    _button11.addEventListener("click", _listener11);
  }
  const _rowNamespace = _MD.renderNamespace(_text.parentNode, _namespace);
  const _rowOwner = { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace, invalidate: () => _rowList.invalidate() };
  const _rowList = _MD.createRowList(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace }, (item) => item.id, (item) => {
    const _row = _Row_row({ "item": item }, _rowOwner);
    return { node: _row.node, update(_item2) {
      item = _item2;
      _row.update({ "item": item });
    }, dispose() {
      _row.dispose();
    } };
  }, ["id"]);
  _rowList.route(_peek_selected, _version_selected, _sharedKey2);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  let _value12 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item }, void 0, void 0)));
  _siteComputation.end();
  _rowList.write(_value12);
  _MD.cleanup(_id, () => {
    _rowList.dispose();
    _siteComputation.dispose();
  });
  function _update() {
    const _updateFrame = _scope.enter();
    if (_siteComputation.changed() || _rowList.changed()) {
      _siteComputation.begin();
      const _next4 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item }, void 0, void 0)));
      _siteComputation.end();
      if (_next4 !== _value12 && !(_next4 !== _next4 && _value12 !== _value12)) {
        _rowList.write(_next4);
        _value12 = _next4;
      }
    }
    _rowList.refresh(_siteComputation);
    _scope.leave(_updateFrame);
  }
  _writes.activate();
  _scope.leave(_setupFrame);
  return _clone;
}
_completeShared(void 0);

export function createCompiledTsxApp() {
  const root = BenchApp('BenchApp', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      if (!b) throw new Error(`Button '${name}' not found in compiled app`);
      b.click();
    },
    selectRow(index: number) {
      (ul.children[index] as HTMLElement).click();
    },
    rowCount() {
      return ul.children.length;
    },
  };
}
