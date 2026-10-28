/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchModuleDataComponent, "./bench/dom/AppModuleDataComponent.tsx#BenchModuleDataComponent");
_MD.defineComponent(Row, "./bench/dom/AppModuleDataComponent.tsx#Row");
function _Row_row(props, _rowOwner2) {
  const _document2 = _MD.getActiveEnvironment().document;
  const _rowId = _rowOwner2.id;
  const _rowWrites = _rowOwner2.batch;
  const _rowEntity = _rowOwner2.entity;
  const _rowNamespace2 = _rowOwner2.namespace;
  const _invalidate = _rowOwner2.invalidate;
  const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace2);
  const _text2 = _clone2.firstChild;
  const _node3 = _text2.nextSibling;
  const _text3 = _node3.nextSibling;
  let _value14 = props.selected ? 'danger' : '';
  if (_value14 != null && _value14 !== false) {
    _clone2.setAttribute("class", _value14 === true ? "" : _MD.textValue(_value14));
  } else {
    _clone2.removeAttribute("class");
  }
  _MD.setListener(_clone2, "click", void 0, () => {
    _MD.observeMethod([() => props], [_invalidate], props, "select", 0, void 0)(props.item.id);
  }, _rowWrites);
  let _value16 = props.item.id;
  const _slotOwner = { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 };
  let _valueSlot = null;
  (_valueSlot = _MD.childSlot(_valueSlot, _text2, _value16, _slotOwner, true))?.write(_value16);
  let _value17 = props.item.label;
  let _valueSlot2 = null;
  (_valueSlot2 = _MD.childSlot(_valueSlot2, _text3, _value17, _slotOwner, true))?.write(_value17);
  return { node: _clone2, update(_nextProps) {
    if (!_MD.sameProps(props, _nextProps)) props = _nextProps;
    const _next = props.selected ? 'danger' : '';
    if (_next !== _value14 && !(_next !== _next && _value14 !== _value14)) {
      if (_next != null && _next !== false) {
        _clone2.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
      } else {
        _clone2.removeAttribute("class");
      }
      _value14 = _next;
    }
    const _next2 = props.item.id;
    if (_next2 !== _value16 && !(_next2 !== _next2 && _value16 !== _value16)) {
      (_valueSlot = _MD.childSlot(_valueSlot, _text2, _next2, _slotOwner, true))?.write(_next2);
      _value16 = _next2;
    }
    const _next3 = props.item.label;
    if (_next3 !== _value17 && !(_next3 !== _next3 && _value17 !== _value17)) {
      (_valueSlot2 = _MD.childSlot(_valueSlot2, _text3, _next3, _slotOwner, true))?.write(_next3);
      _value17 = _next3;
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
  const _document3 = _MD.getActiveEnvironment().document;
  const _clone3 = _MD.cloneTemplate(_template3, _namespace2);
  const _text4 = _clone3.firstChild;
  const _node4 = _text4.nextSibling;
  const _text5 = _node4.nextSibling;
  const _siteComputation2 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation2.begin();
  let _value18 = props.selected ? 'danger' : '';
  _siteComputation2.end();
  if (_value18 != null && _value18 !== false) {
    _clone3.setAttribute("class", _value18 === true ? "" : _MD.textValue(_value18));
  } else {
    _clone3.removeAttribute("class");
  }
  let _seen = _propsVersion;
  _MD.setListener(_clone3, "click", void 0, () => {
    _MD.observeMethod([() => props], [_mutated_props], _MD.trackRead(() => _propsVersion, props, _readKey2), "select", 0, void 0)(_MD.trackRead(() => _propsVersion, props, _readKey2).item.id);
  }, _writes2);
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _value20 = props.item.id;
  _siteComputation3.end();
  const _slotOwner2 = { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 };
  let _valueSlot3 = null;
  (_valueSlot3 = _MD.childSlot(_valueSlot3, _text4, _value20, _slotOwner2, true))?.write(_value20);
  let _seen2 = _propsVersion;
  const _siteComputation4 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation4.begin();
  let _value21 = props.item.label;
  _siteComputation4.end();
  let _valueSlot4 = null;
  (_valueSlot4 = _MD.childSlot(_valueSlot4, _text5, _value21, _slotOwner2, true))?.write(_value21);
  let _seen3 = _propsVersion;
  let _publishedVersion2 = _propsVersion;
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
      const _next5 = props.selected ? 'danger' : '';
      _siteComputation2.end();
      if (_next5 !== _value18 && !(_next5 !== _next5 && _value18 !== _value18)) {
        if (_next5 != null && _next5 !== false) {
          _clone3.setAttribute("class", _next5 === true ? "" : _MD.textValue(_next5));
        } else {
          _clone3.removeAttribute("class");
        }
        _value18 = _next5;
      }
      _seen = _propsVersion;
    }
    if (_propsVersion !== _seen2 || _siteComputation3.changed()) {
      _siteComputation3.begin();
      const _next6 = props.item.id;
      _siteComputation3.end();
      if (_next6 !== _value20 && !(_next6 !== _next6 && _value20 !== _value20)) {
        (_valueSlot3 = _MD.childSlot(_valueSlot3, _text4, _next6, _slotOwner2, true))?.write(_next6);
        _value20 = _next6;
      }
      _seen2 = _propsVersion;
    }
    if (_propsVersion !== _seen3 || _siteComputation4.changed()) {
      _siteComputation4.begin();
      const _next7 = props.item.label;
      _siteComputation4.end();
      if (_next7 !== _value21 && !(_next7 !== _next7 && _value21 !== _value21)) {
        (_valueSlot4 = _MD.childSlot(_valueSlot4, _text5, _next7, _slotOwner2, true))?.write(_next7);
        _value21 = _next7;
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
  return _clone3;
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
  _MD.setListener(_button, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(1000);
    _write(selected = null);
  }, _writes);
  _MD.setListener(_button2, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = buildData(10000);
    _write(selected = null);
  }, _writes);
  _MD.setListener(_button3, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "concat", 0, void 0)(buildData(1000));
  }, _writes);
  _MD.setListener(_button4, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_read_data());
  }, _writes);
  _MD.setListener(_button5, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "slice", 0, void 0)(0, -1000);
  }, _writes);
  _MD.setListener(_button6, "click", void 0, () => {
    for (let i = 0; i < _read_data().length; i += 10) _MD.mutationTarget(_read_data()[i], "label", _mutated_data).value += ' !!!';
  }, _writes);
  _MD.setListener(_button7, "click", void 0, () => {
    if (_read_data().length > 998) {
      const t = _read_data()[1];
      _MD.mutationTarget(_read_data(), 1, _mutated_data).value = _read_data()[998];
      _MD.mutationTarget(_read_data(), 998, _mutated_data).value = t;
    }
  }, _writes);
  _MD.setListener(_button8, "click", void 0, () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "reverse", 0, void 0)();
  }, _writes);
  _MD.setListener(_button9, "click", void 0, () => {
    _MD.observeMethod([() => data], [_mutated_data], _read_data(), "splice", 0, void 0)(500, 1);
  }, _writes);
  _MD.setListener(_button10, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "filter", 1, void 0)((_item, index) => index % 100 !== 0);
  }, _writes);
  _MD.setListener(_button11, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = [];
    _write(selected = null);
  }, _writes);
  const _rowNamespace = _MD.renderNamespace(_text.parentNode, _namespace);
  const _rowOwner = { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace, invalidate: () => _rowList.invalidate() };
  const _rowList = _MD.createRowList(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace }, (item) => item.id, (item) => {
    const _row = _Row_row({ "item": item, "selected": selected === item.id, "select": select }, _rowOwner);
    return { node: _row.node, update(_item2) {
      item = _item2;
      _row.update({ "item": item, "selected": selected === item.id, "select": select });
    }, dispose() {
      _row.dispose();
    } };
  }, ["id"]);
  _rowList.route(() => selected, () => _selectedVersion, void 0);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  let _value13 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey), "select": select }, void 0, void 0)));
  _siteComputation.end();
  _rowList.write(_value13);
  let _publishedVersion = _selectedVersion;
  _MD.cleanup(_id, () => {
    _rowList.dispose();
    _siteComputation.dispose();
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
    if (_siteComputation.changed() || _rowList.changed()) {
      _siteComputation.begin();
      const _next4 = _MD.observeMethod([() => data], [_mutated_data], _read_data(), "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey), "select": select }, void 0, void 0)));
      _siteComputation.end();
      if (_next4 !== _value13 && !(_next4 !== _next4 && _value13 !== _value13)) {
        _rowList.write(_next4);
        _value13 = _next4;
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
  return _clone;
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
