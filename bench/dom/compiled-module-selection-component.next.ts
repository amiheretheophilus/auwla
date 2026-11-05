/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchModuleSelectionComponent, "./bench/dom/AppModuleSelectionComponent.tsx#BenchModuleSelectionComponent");
function _Row_row(props, _rowOwner2) {
  const _rowWrites = _rowOwner2.batch;
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
  _text2.data = _MD.textValue(_part) + ": " + _MD.textValue(_part2);
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
      _text2.data = _MD.textValue(_nextPart) + ": " + _MD.textValue(_nextPart2);
      _part = _nextPart;
      _part2 = _nextPart2;
    }
  } };
}
const _template = _MD.createTemplateCache([["div", 0, ["div", ["class", "toolbar"], ["button", 0, "create1k"], ["button", 0, "create10k"], ["button", 0, "append1k"], ["button", 0, "prepend1k"], ["button", 0, "pop1k"], ["button", 0, "update"], ["button", 0, "swap"], ["button", 0, "reverse"], ["button", 0, "remove"], ["button", 0, "remove100"], ["button", 0, "clear"]], ["ul", 0, ""]]]);
const _template2 = _MD.createTemplateCache([["li", 0, ""]]);
let _selectedVersion = 0;
const _sharedKey = {};
function _mutated_selected(_value) {
  _selectedVersion++;
  _sharedWrites.mark(_sharedKey);
  return _value;
}
function _version_selected() {
  return _selectedVersion;
}
function _read_selected() {
  return _MD.trackRead(_version_selected, selected, _sharedKey);
}
export { _read_selected };
function _peek_selected() {
  return selected;
}
const _sharedWrites = _MD.createSharedWrites([_sharedKey], []);
function _assign_selected(_before, _after) {
  return _MD.unchangedWrite(_before, _after) ? _after : _mutated_selected(_after);
}
import { buildData } from './data';
let selected = null;
_sharedWrites.watch([{ read: () => selected, notify: _mutated_selected }]);
;
export function BenchModuleSelectionComponent(_id, _parent, _props, _namespace, _setupOnly) {
  let _dataVersion = 0;
  function _mutated_data() {
    _dataVersion++;
    _writes.mark();
  }
  function _moved_data(_value2) {
    _mutated_data();
    return _value2;
  }
  var _edits_data = 0;
  function _edited_data(_value3) {
    _edits_data++;
    _mutated_data();
    return _value3;
  }
  function _write(_value4) {
    _dataVersion++;
    _writes.mark();
    return _value4;
  }
  function _assign(_before2, _after2) {
    return _MD.unchangedWrite(_before2, _after2) ? _after2 : _write(_after2);
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
    _assign(data, data = buildData(1000));
    _assign_selected(selected, selected = null);
  }, _writes);
  _MD.setListener(_button2, "click", void 0, () => {
    _assign(data, data = buildData(10000));
    _assign_selected(selected, selected = null);
  }, _writes);
  _MD.setListener(_button3, "click", void 0, () => {
    _assign(data, data = data.concat(buildData(1000)));
  }, _writes);
  _MD.setListener(_button4, "click", void 0, () => {
    _assign(data, data = buildData(1000).concat(data));
  }, _writes);
  _MD.setListener(_button5, "click", void 0, () => {
    _assign(data, data = data.slice(0, -1000));
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
    _assign(data, data = data.filter((_item, index) => index % 100 !== 0));
  }, _writes);
  _MD.setListener(_button11, "click", void 0, () => {
    _assign(data, data = []);
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
    } };
  }, null);
  _rowList.route(_peek_selected, _version_selected, _sharedKey);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  _rowList.map(data, _seenEdits === (_seenEdits = _edits_data));
  _siteComputation.end();
  let _seen = _dataVersion;
  _MD.cleanup(_id, () => {
    _rowList.dispose();
    _siteComputation.dispose();
  });
  function _update() {
    const _updateFrame = _scope.enter();
    if (_dataVersion !== _seen || _siteComputation.changed() || _rowList.changed()) {
      _siteComputation.begin();
      _rowList.map(data, _seenEdits === (_seenEdits = _edits_data));
      _siteComputation.end();
      _seen = _dataVersion;
    }
    _rowList.refresh(_siteComputation);
    _scope.leave(_updateFrame);
  }
  _writes.activate();
  _scope.leave(_setupFrame);
  return _clone;
}

export function createModuleSelectionComponent() {
  const root = BenchModuleSelectionComponent('BenchModuleSelectionComponent', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppModuleSelectionComponent`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
