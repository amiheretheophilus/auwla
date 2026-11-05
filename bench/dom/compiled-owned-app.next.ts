/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchAppOwned, "./bench/dom/AppOwned.tsx#BenchAppOwned");
_MD.defineComponent(Row, "./bench/dom/AppOwned.tsx#Row");
function _Row_row(props, _rowOwner2) {
  const _rowId = _rowOwner2.id;
  const _rowWrites = _rowOwner2.batch;
  const _rowEntity = _rowOwner2.entity;
  const _rowNamespace2 = _rowOwner2.namespace;
  const _invalidate = _rowOwner2.invalidate;
  const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace2);
  const _text2 = _clone2.firstChild;
  let _value15 = props.selected ? 'danger' : '';
  _MD.setAttributeValue(_clone2, "class", _value15);
  _MD.setRowListener(_clone2, "click", () => {
    _MD.observeMutation([() => props], [_invalidate]).finish(props.select(props.item.id));
  }, _rowWrites);
  let _part = props.item.id;
  let _part2 = props.item.label;
  let _fused = null;
  const _slotOwner = { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 };
  _fused = _MD.fuseText(_fused, _text2, [_part, ": ", _part2], _slotOwner);
  return { node: _clone2, update(_nextProps) {
    if (props["item"] !== _nextProps["item"] || props["selected"] !== _nextProps["selected"] || props["select"] !== _nextProps["select"]) props = _nextProps;
    const _next = props.selected ? 'danger' : '';
    if (_next !== _value15) {
      _MD.setAttributeValue(_clone2, "class", _next);
      _value15 = _next;
    }
    const _nextPart = props.item.id;
    const _nextPart2 = props.item.label;
    if (_nextPart !== _part || _nextPart2 !== _part2) {
      _fused = _MD.fuseText(_fused, _text2, [_nextPart, ": ", _nextPart2], _slotOwner);
      _part = _nextPart;
      _part2 = _nextPart2;
    }
  }, dispose() {
    _fused = _MD.disposeFused(_fused);
  } };
}
const _template = _MD.createTemplateCache([["div", 0, ["div", ["class", "toolbar"], ["button", 0, "create1k"], ["button", 0, "create10k"], ["button", 0, "append1k"], ["button", 0, "prepend1k"], ["button", 0, "pop1k"], ["button", 0, "update"], ["button", 0, "swap"], ["button", 0, "reverse"], ["button", 0, "remove"], ["button", 0, "remove100"], ["button", 0, "clear"]], ["ul", 0, ""]]]);
const _template2 = _MD.createTemplateCache([["li", 0, ""]]);
import { buildData } from './data';
function Row(_id2, _parent2, _props2, _namespace2, _setupOnly2) {
  let _propsVersion = 0;
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
  const _clone3 = _MD.cloneTemplate(_template2, _namespace2);
  const _text3 = _clone3.firstChild;
  const _siteComputation2 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation2.begin();
  let _value18 = props.selected ? 'danger' : '';
  _siteComputation2.end();
  _MD.setAttributeValue(_clone3, "class", _value18);
  let _seen2 = _propsVersion;
  _MD.setListener(_clone3, "click", void 0, () => {
    _MD.observeMutation([() => props], [_mutated_props]).finish(props.select(props.item.id));
  }, _writes2);
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _part3 = props.item.id;
  let _part4 = props.item.label;
  _siteComputation3.end();
  let _fused2 = null;
  const _slotOwner2 = { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 };
  _fused2 = _MD.fuseText(_fused2, _text3, [_part3, ": ", _part4], _slotOwner2);
  let _seen3 = _propsVersion;
  _MD.cleanup(_id2, () => {
    _siteComputation2.dispose();
    _siteComputation3.dispose();
    _fused2 = _MD.disposeFused(_fused2);
  });
  function _update2() {
    const _updateFrame2 = _scope2.enter();
    if (_propsVersion !== _seen2 || _siteComputation2.changed()) {
      _siteComputation2.begin();
      const _next4 = props.selected ? 'danger' : '';
      _siteComputation2.end();
      if (_next4 !== _value18) {
        _MD.setAttributeValue(_clone3, "class", _next4);
        _value18 = _next4;
      }
      _seen2 = _propsVersion;
    }
    if (_propsVersion !== _seen3 || _siteComputation3.changed()) {
      _siteComputation3.begin();
      const _nextPart3 = props.item.id;
      const _nextPart4 = props.item.label;
      _siteComputation3.end();
      if (_nextPart3 !== _part3 || _nextPart4 !== _part4) {
        _fused2 = _MD.fuseText(_fused2, _text3, [_nextPart3, ": ", _nextPart4], _slotOwner2);
        _part3 = _nextPart3;
        _part4 = _nextPart4;
      }
      _seen3 = _propsVersion;
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
    _write(data = buildData(1000));
    _write2(selected = null);
  }, _writes);
  _MD.setListener(_button2, "click", void 0, () => {
    _write(data = buildData(10000));
    _write2(selected = null);
  }, _writes);
  _MD.setListener(_button3, "click", void 0, () => {
    _write(data = data.concat(buildData(1000)));
  }, _writes);
  _MD.setListener(_button4, "click", void 0, () => {
    _write(data = buildData(1000).concat(data));
  }, _writes);
  _MD.setListener(_button5, "click", void 0, () => {
    _write(data = data.slice(0, -1000));
  }, _writes);
  _MD.setListener(_button6, "click", void 0, () => {
    for (let i = 0; i < data.length; i += 10) _MD.mutationTarget(data[i], "label", _mutated_data).value += ' !!!';
  }, _writes);
  _MD.setListener(_button7, "click", void 0, () => {
    if (data.length > 998) {
      const t = data[1];
      _MD.mutationTarget(data, 1, _mutated_data).value = data[998];
      _MD.mutationTarget(data, 998, _mutated_data).value = t;
    }
  }, _writes);
  _MD.setListener(_button8, "click", void 0, () => {
    _MD.editArray(data, "reverse", [], _mutated_data);
  }, _writes);
  _MD.setListener(_button9, "click", void 0, () => {
    _MD.editArray(data, "splice", [500, 1], _mutated_data);
  }, _writes);
  _MD.setListener(_button10, "click", void 0, () => {
    _write(data = data.filter((_item, index) => index % 100 !== 0));
  }, _writes);
  _MD.setListener(_button11, "click", void 0, () => {
    _write(data = []);
    _write2(selected = null);
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
  _rowList.map(data);
  _siteComputation.end();
  let _seen = _dataVersion;
  let _publishedVersion = _selectedVersion;
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
      _rowList.map(data);
      _siteComputation.end();
      _seen = _dataVersion;
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
