/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchModuleDataInline, "./bench/dom/AppModuleDataInline.tsx#BenchModuleDataInline");
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
const _sharedWrites = _MD.createSharedWrites([_sharedKey], []);
function _assign_data(_before, _after) {
  return _MD.unchangedWrite(_before, _after) ? _after : _mutated_data(_after);
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
import { buildData } from './data';
let data = [];
export function BenchModuleDataInline(_id, _parent, _props, _namespace, _setupOnly) {
  let _selectedVersion = 0;
  const _readKey = {};
  function _write(_value4) {
    _selectedVersion++;
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
  let selected = null;
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
    _assign(selected, selected = null);
  }, _writes);
  _MD.setListener(_button2, "click", void 0, () => {
    _assign_data(data, data = buildData(10000));
    _assign(selected, selected = null);
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
    _assign(selected, selected = null);
  }, _writes);
  const _rowNamespace = _MD.renderNamespace(_text.parentNode, _namespace);
  let _seenEdits = 0;
  const _rowList = _MD.createRowList(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace }, (item) => item.id, (item) => {
    const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace);
    const _text2 = _clone2.firstChild;
    let _value17 = selected === item.id ? 'danger' : '';
    _MD.setAttributeValue(_clone2, "class", _value17);
    _MD.setRowListener(_clone2, "click", () => {
      _assign(selected, selected = item.id);
    }, _writes);
    let _part = item.id;
    let _part2 = item.label;
    _MD.setTextData(_text2, _MD.joinText([_part, ": ", _part2]));
    return { node: _clone2, update(_item2) {
      item = _item2;
      const _next = selected === item.id ? 'danger' : '';
      if (_next !== _value17) {
        _MD.setAttributeValue(_clone2, "class", _next);
        _value17 = _next;
      }
      const _nextPart = item.id;
      const _nextPart2 = item.label;
      if (_nextPart !== _part || _nextPart2 !== _part2) {
        _MD.setTextData(_text2, _MD.joinText([_nextPart, ": ", _nextPart2]));
        _part = _nextPart;
        _part2 = _nextPart2;
      }
    }, dispose() {} };
  }, null);
  _rowList.route(() => selected, () => _selectedVersion, void 0);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  _rowList.map(_read_data(), _seenEdits === (_seenEdits = _edits_data));
  _siteComputation.end();
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
      _rowList.map(_read_data(), _seenEdits === (_seenEdits = _edits_data));
      _siteComputation.end();
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
