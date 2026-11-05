/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchApp, "./bench/dom/App.tsx#BenchApp");
_MD.defineComponent(Row, "./bench/dom/App.tsx#Row");
function _Row_row(props, _rowOwner2) {
  const _rowId = _rowOwner2.id;
  const _rowWrites = _rowOwner2.batch;
  const _rowEntity = _rowOwner2.entity;
  const _rowNamespace2 = _rowOwner2.namespace;
  const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace2);
  const _text2 = _clone2.firstChild;
  let _value17 = _peek_selected() === props.item.id ? 'danger' : '';
  _MD.setClassAttribute(_clone2, _value17);
  _MD.setRowListener(_clone2, "click", () => {
    _assign_selected(selected, selected = props.item.id);
  }, _rowWrites);
  let _part = props.item.id;
  let _part2 = props.item.label;
  let _fused = null;
  const _slotOwner = { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 };
  _fused = _MD.fuseText(_fused, _text2, [_part, ": ", _part2], _slotOwner);
  return { node: _clone2, update(_nextProps) {
    props = _nextProps;
    const _next = _peek_selected() === props.item.id ? 'danger' : '';
    if (_next !== _value17) {
      _MD.setClassAttribute(_clone2, _next);
      _value17 = _next;
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
let _dataVersion = 0;
const _sharedKey = {};
function _mutated_data(_value) {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
  return _value;
}
function _version_data() {
  return _dataVersion;
}
function _read_data() {
  return _MD.trackRead(_version_data, data, _sharedKey);
}
export { _read_data };
let _selectedVersion = 0;
const _sharedKey2 = {};
function _mutated_selected(_value2) {
  _selectedVersion++;
  _sharedWrites.mark(_sharedKey2);
  return _value2;
}
function _version_selected() {
  return _selectedVersion;
}
function _read_selected() {
  return _MD.trackRead(_version_selected, selected, _sharedKey2);
}
export { _read_selected };
function _peek_selected() {
  return selected;
}
const _sharedWrites = _MD.createSharedWrites([_sharedKey, _sharedKey2], []);
function _assign_data(_before, _after) {
  return _MD.unchangedWrite(_before, _after) ? _after : _mutated_data(_after);
}
function _assign_selected(_before2, _after2) {
  return _MD.unchangedWrite(_before2, _after2) ? _after2 : _mutated_selected(_after2);
}
function _moved_data(_value3) {
  _mutated_data();
  return _value3;
}
var _edits_data = 0;
function _edited_data(_value4) {
  _edits_data++;
  _mutated_data();
  return _value4;
}
import { buildData } from './data';
let data = [];
let selected = null;
_sharedWrites.watch([{ read: () => selected, notify: _mutated_selected }]);
function Row(_id2, _parent2, _props2, _namespace2, _setupOnly2) {
  let _propsVersion = 0;
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
  let _value20 = _MD.trackEquals(_peek_selected(), props.item.id, _peek_selected, _version_selected, _sharedKey2) ? 'danger' : '';
  _siteComputation2.end();
  _MD.setClassAttribute(_clone3, _value20);
  let _seen = _propsVersion;
  _MD.setListener(_clone3, "click", void 0, () => {
    _assign_selected(selected, selected = props.item.id);
  }, _writes2);
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _part3 = props.item.id;
  let _part4 = props.item.label;
  _siteComputation3.end();
  let _fused2 = null;
  const _slotOwner2 = { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 };
  _fused2 = _MD.fuseText(_fused2, _text3, [_part3, ": ", _part4], _slotOwner2);
  let _seen2 = _propsVersion;
  _MD.cleanup(_id2, () => {
    _siteComputation2.dispose();
    _siteComputation3.dispose();
    _fused2 = _MD.disposeFused(_fused2);
  });
  function _update2() {
    const _updateFrame2 = _scope2.enter();
    if (_propsVersion !== _seen || _siteComputation2.changed()) {
      _siteComputation2.begin();
      const _next4 = _MD.trackEquals(_peek_selected(), props.item.id, _peek_selected, _version_selected, _sharedKey2) ? 'danger' : '';
      _siteComputation2.end();
      if (_next4 !== _value20) {
        _MD.setClassAttribute(_clone3, _next4);
        _value20 = _next4;
      }
      _seen = _propsVersion;
    }
    if (_propsVersion !== _seen2 || _siteComputation3.changed()) {
      _siteComputation3.begin();
      const _nextPart3 = props.item.id;
      const _nextPart4 = props.item.label;
      _siteComputation3.end();
      if (_nextPart3 !== _part3 || _nextPart4 !== _part4) {
        _fused2 = _MD.fuseText(_fused2, _text3, [_nextPart3, ": ", _nextPart4], _slotOwner2);
        _part3 = _nextPart3;
        _part4 = _nextPart4;
      }
      _seen2 = _propsVersion;
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
    _assign_data(data, data = buildData(1000));
    _assign_selected(selected, selected = null);
  }, _writes);
  _MD.setListener(_button2, "click", void 0, () => {
    _assign_data(data, data = buildData(10000));
    _assign_selected(selected, selected = null);
  }, _writes);
  _MD.setListener(_button3, "click", void 0, () => {
    _assign_data(data, data = data.concat(buildData(1000)));
  }, _writes);
  _MD.setListener(_button4, "click", void 0, () => {
    _assign_data(data, data = buildData(1000).concat(data));
  }, _writes);
  _MD.setListener(_button5, "click", void 0, () => {
    _assign_data(data, data = data.slice(0, -1000));
  }, _writes);
  _MD.setListener(_button6, "click", void 0, () => {
    for (let i = 0; i < data.length; i += 10) _edited_data(data[i].label += ' !!!');
  }, _writes);
  _MD.setListener(_button7, "click", void 0, () => {
    if (data.length > 998) {
      const t = data[1];
      _moved_data(data[1] = data[998]);
      _moved_data(data[998] = t);
    }
  }, _writes);
  _MD.setListener(_button8, "click", void 0, () => {
    _MD.editArray(data, "reverse", [], _moved_data);
  }, _writes);
  _MD.setListener(_button9, "click", void 0, () => {
    _MD.editArray(data, "splice", [500, 1], _moved_data);
  }, _writes);
  _MD.setListener(_button10, "click", void 0, () => {
    _assign_data(data, data = data.filter((_item, index) => index % 100 !== 0));
  }, _writes);
  _MD.setListener(_button11, "click", void 0, () => {
    _assign_data(data, data = []);
    _assign_selected(selected, selected = null);
  }, _writes);
  const _rowNamespace = _MD.renderNamespace(_text.parentNode, _namespace);
  let _seenEdits = 0;
  const _rowOwner = { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace, invalidate: () => _rowList.invalidate() };
  const _rowList = _MD.createRowList(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace }, (item) => item.id, (item) => {
    const _row = _Row_row({ "item": item }, _rowOwner);
    return { node: _row.node, update(_item2) {
      item = _item2;
      _row.update({ "item": item });
    }, dispose() {
      _row.dispose();
    } };
  }, null);
  _rowList.route(_peek_selected, _version_selected, _sharedKey2);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  _rowList.map(_read_data(), _seenEdits === (_seenEdits = _edits_data));
  _siteComputation.end();
  _MD.cleanup(_id, () => {
    _rowList.dispose();
    _siteComputation.dispose();
  });
  function _update() {
    const _updateFrame = _scope.enter();
    if (_siteComputation.changed() || _rowList.changed()) {
      _siteComputation.begin();
      _rowList.map(_read_data(), _seenEdits === (_seenEdits = _edits_data));
      _siteComputation.end();
    }
    _rowList.refresh(_siteComputation);
    _scope.leave(_updateFrame);
  }
  _writes.activate();
  _scope.leave(_setupFrame);
  return _clone;
}

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
