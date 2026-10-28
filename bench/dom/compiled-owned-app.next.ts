/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchAppOwned, "./bench/dom/AppOwned.tsx#BenchAppOwned");
_MD.defineComponent(Row, "./bench/dom/AppOwned.tsx#Row");
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
  let _value15 = props.selected ? 'danger' : '';
  if (_value15 != null && _value15 !== false) {
    _clone2.setAttribute("class", _value15 === true ? "" : _MD.textValue(_value15));
  } else {
    _clone2.removeAttribute("class");
  }
  let _value16 = () => {
    _MD.observeMethod([() => props], [_invalidate], props, "select", 0, void 0)(props.item.id);
  };
  let _listener12;
  if (_listener12 !== undefined) _clone2.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value16 === "function") {
    _listener12 = _rowWrites === null ? _value16 : _rowWrites.listener(_value16);
    _clone2.addEventListener("click", _listener12);
  }
  let _value17 = props.item.id;
  let _valueSlot = null;
  if (_valueSlot === null && (_value17 === null || typeof _value17 !== "object")) {
    _MD.setTextData(_text2, _value17);
  } else {
    (_valueSlot ??= _MD.createIndexedValueSlot(_text2, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_value17);
  }
  let _value18 = props.item.label;
  let _valueSlot2 = null;
  if (_valueSlot2 === null && (_value18 === null || typeof _value18 !== "object")) {
    _MD.setTextData(_text3, _value18);
  } else {
    (_valueSlot2 ??= _MD.createIndexedValueSlot(_text3, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_value18);
  }
  return { node: _clone2, update(_nextProps) {
    if (!_MD.sameProps(props, _nextProps)) props = _nextProps;
    const _next = props.selected ? 'danger' : '';
    if (_next !== _value15 && !(_next !== _next && _value15 !== _value15)) {
      if (_next != null && _next !== false) {
        _clone2.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
      } else {
        _clone2.removeAttribute("class");
      }
      _value15 = _next;
    }
    const _next2 = props.item.id;
    if (_next2 !== _value17 && !(_next2 !== _next2 && _value17 !== _value17)) {
      if (_valueSlot === null && (_next2 === null || typeof _next2 !== "object")) {
        _MD.setTextData(_text2, _next2);
      } else {
        (_valueSlot ??= _MD.createIndexedValueSlot(_text2, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_next2);
      }
      _value17 = _next2;
    }
    const _next3 = props.item.label;
    if (_next3 !== _value18 && !(_next3 !== _next3 && _value18 !== _value18)) {
      if (_valueSlot2 === null && (_next3 === null || typeof _next3 !== "object")) {
        _MD.setTextData(_text3, _next3);
      } else {
        (_valueSlot2 ??= _MD.createIndexedValueSlot(_text3, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_next3);
      }
      _value18 = _next3;
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
import { buildData } from './data';
function Row(_id2, _parent2, _props2, _namespace2, _setupOnly2) {
  let _propsVersion = 0;
  const _readKey3 = {};
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
  let _value19 = props.selected ? 'danger' : '';
  _siteComputation2.end();
  if (_value19 != null && _value19 !== false) {
    _clone3.setAttribute("class", _value19 === true ? "" : _MD.textValue(_value19));
  } else {
    _clone3.removeAttribute("class");
  }
  let _seen2 = _propsVersion;
  let _value20 = () => {
    _MD.observeMethod([() => props], [_mutated_props], _MD.trackRead(() => _propsVersion, props, _readKey3), "select", 0, void 0)(_MD.trackRead(() => _propsVersion, props, _readKey3).item.id);
  };
  let _listener13;
  if (_listener13 !== undefined) _clone3.removeEventListener("click", _listener13);
  _listener13 = undefined;
  if (typeof _value20 === "function") {
    _listener13 = _writes2 === null ? _value20 : _writes2.listener(_value20);
    _clone3.addEventListener("click", _listener13);
  }
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _value21 = props.item.id;
  _siteComputation3.end();
  let _valueSlot3 = null;
  if (_valueSlot3 === null && (_value21 === null || typeof _value21 !== "object")) {
    _MD.setTextData(_text4, _value21);
  } else {
    (_valueSlot3 ??= _MD.createIndexedValueSlot(_text4, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_value21);
  }
  let _seen3 = _propsVersion;
  const _siteComputation4 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation4.begin();
  let _value22 = props.item.label;
  _siteComputation4.end();
  let _valueSlot4 = null;
  if (_valueSlot4 === null && (_value22 === null || typeof _value22 !== "object")) {
    _MD.setTextData(_text5, _value22);
  } else {
    (_valueSlot4 ??= _MD.createIndexedValueSlot(_text5, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_value22);
  }
  let _seen4 = _propsVersion;
  let _publishedVersion3 = _propsVersion;
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
    if (_propsVersion !== _seen2 || _siteComputation2.changed()) {
      _siteComputation2.begin();
      const _next5 = props.selected ? 'danger' : '';
      _siteComputation2.end();
      if (_next5 !== _value19 && !(_next5 !== _next5 && _value19 !== _value19)) {
        if (_next5 != null && _next5 !== false) {
          _clone3.setAttribute("class", _next5 === true ? "" : _MD.textValue(_next5));
        } else {
          _clone3.removeAttribute("class");
        }
        _value19 = _next5;
      }
      _seen2 = _propsVersion;
    }
    if (_propsVersion !== _seen3 || _siteComputation3.changed()) {
      _siteComputation3.begin();
      const _next6 = props.item.id;
      _siteComputation3.end();
      if (_next6 !== _value21 && !(_next6 !== _next6 && _value21 !== _value21)) {
        if (_valueSlot3 === null && (_next6 === null || typeof _next6 !== "object")) {
          _MD.setTextData(_text4, _next6);
        } else {
          (_valueSlot3 ??= _MD.createIndexedValueSlot(_text4, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_next6);
        }
        _value21 = _next6;
      }
      _seen3 = _propsVersion;
    }
    if (_propsVersion !== _seen4 || _siteComputation4.changed()) {
      _siteComputation4.begin();
      const _next7 = props.item.label;
      _siteComputation4.end();
      if (_next7 !== _value22 && !(_next7 !== _next7 && _value22 !== _value22)) {
        if (_valueSlot4 === null && (_next7 === null || typeof _next7 !== "object")) {
          _MD.setTextData(_text5, _next7);
        } else {
          (_valueSlot4 ??= _MD.createIndexedValueSlot(_text5, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 })).write(_next7);
        }
        _value22 = _next7;
      }
      _seen4 = _propsVersion;
    }
    if (_publishedVersion3 !== _propsVersion) {
      _publishedVersion3 = _propsVersion;
      _MD.publishVersions([_readKey3]);
    }
    _scope2.leave(_updateFrame2);
  }
  _writes2.activate();
  _scope2.leave(_setupFrame2);
  return _clone3;
}
export function BenchAppOwned(_id, _parent, _props, _namespace, _setupOnly) {
  let _dataVersion = 0;
  let _selectedVersion = 0;
  let _selectVersion = 0;
  const _readKey = {};
  const _readKey2 = {};
  function _mutated_data() {
    _dataVersion++;
    _writes.mark();
  }
  function _write(_value) {
    _dataVersion++;
    _writes.mark();
    return _value;
  }
  function _write2(_value2) {
    _selectedVersion++;
    _writes.mark();
    return _value2;
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
  const select = (id) => {
    _write2(selected = id);
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
  let _value3 = () => {
    _write(data = buildData(1000));
    _write2(selected = null);
  };
  let _listener;
  if (_listener !== undefined) _button.removeEventListener("click", _listener);
  _listener = undefined;
  if (typeof _value3 === "function") {
    _listener = _writes === null ? _value3 : _writes.listener(_value3);
    _button.addEventListener("click", _listener);
  }
  let _value4 = () => {
    _write(data = buildData(10000));
    _write2(selected = null);
  };
  let _listener2;
  if (_listener2 !== undefined) _button2.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value4 === "function") {
    _listener2 = _writes === null ? _value4 : _writes.listener(_value4);
    _button2.addEventListener("click", _listener2);
  }
  let _value5 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "concat", 0, void 0)(buildData(1000)));
  };
  let _listener3;
  if (_listener3 !== undefined) _button3.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value5 === "function") {
    _listener3 = _writes === null ? _value5 : _writes.listener(_value5);
    _button3.addEventListener("click", _listener3);
  }
  let _value6 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_MD.trackRead(() => _dataVersion, data, _readKey)));
  };
  let _listener4;
  if (_listener4 !== undefined) _button4.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value6 === "function") {
    _listener4 = _writes === null ? _value6 : _writes.listener(_value6);
    _button4.addEventListener("click", _listener4);
  }
  let _value7 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "slice", 0, void 0)(0, -1000));
  };
  let _listener5;
  if (_listener5 !== undefined) _button5.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value7 === "function") {
    _listener5 = _writes === null ? _value7 : _writes.listener(_value7);
    _button5.addEventListener("click", _listener5);
  }
  let _value8 = () => {
    for (let i = 0; i < _MD.trackRead(() => _dataVersion, data, _readKey).length; i += 10) _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey)[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener6;
  if (_listener6 !== undefined) _button6.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value8 === "function") {
    _listener6 = _writes === null ? _value8 : _writes.listener(_value8);
    _button6.addEventListener("click", _listener6);
  }
  let _value9 = () => {
    if (_MD.trackRead(() => _dataVersion, data, _readKey).length > 998) {
      const t = _MD.trackRead(() => _dataVersion, data, _readKey)[1];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 1, _mutated_data).value = _MD.trackRead(() => _dataVersion, data, _readKey)[998];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 998, _mutated_data).value = t;
    }
  };
  let _listener7;
  if (_listener7 !== undefined) _button7.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value9 === "function") {
    _listener7 = _writes === null ? _value9 : _writes.listener(_value9);
    _button7.addEventListener("click", _listener7);
  }
  let _value10 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "reverse", 0, void 0)();
  };
  let _listener8;
  if (_listener8 !== undefined) _button8.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value10 === "function") {
    _listener8 = _writes === null ? _value10 : _writes.listener(_value10);
    _button8.addEventListener("click", _listener8);
  }
  let _value11 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "splice", 0, void 0)(500, 1);
  };
  let _listener9;
  if (_listener9 !== undefined) _button9.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value11 === "function") {
    _listener9 = _writes === null ? _value11 : _writes.listener(_value11);
    _button9.addEventListener("click", _listener9);
  }
  let _value12 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "filter", 1, void 0)((_item, index) => index % 100 !== 0));
  };
  let _listener10;
  if (_listener10 !== undefined) _button10.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value12 === "function") {
    _listener10 = _writes === null ? _value12 : _writes.listener(_value12);
    _button10.addEventListener("click", _listener10);
  }
  let _value13 = () => {
    _write(data = []);
    _write2(selected = null);
  };
  let _listener11;
  if (_listener11 !== undefined) _button11.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value13 === "function") {
    _listener11 = _writes === null ? _value13 : _writes.listener(_value13);
    _button11.addEventListener("click", _listener11);
  }
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
  let _value14 = _MD.observeMethod([() => data], [_mutated_data], data, "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2), "select": select }, void 0, void 0)));
  _siteComputation.end();
  _rowList.write(_value14);
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
  } }, { read: () => select, notify: () => {
    _selectVersion++;
    if (!_scope.building()) _writes.mark();
  } }]);
  function _update() {
    const _updateFrame = _scope.enter();
    if (_dataVersion !== _seen || _siteComputation.changed() || _rowList.changed()) {
      _siteComputation.begin();
      const _next4 = _MD.observeMethod([() => data], [_mutated_data], data, "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2), "select": select }, void 0, void 0)));
      _siteComputation.end();
      if (_next4 !== _value14 && !(_next4 !== _next4 && _value14 !== _value14)) {
        _rowList.write(_next4);
        _value14 = _next4;
      }
      _seen = _dataVersion;
    }
    _rowList.refresh(_siteComputation);
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
  return _clone;
}

export function createCompiledOwnedApp() {
  const root = BenchAppOwned('BenchAppOwned', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppOwned`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
