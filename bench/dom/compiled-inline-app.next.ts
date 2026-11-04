/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchAppInline, "./bench/dom/AppInline.tsx#BenchAppInline");
const _template = _MD.createTemplateCache([["div", 0, ["div", ["class", "toolbar"], ["button", 0, "create1k"], ["button", 0, "create10k"], ["button", 0, "append1k"], ["button", 0, "prepend1k"], ["button", 0, "pop1k"], ["button", 0, "update"], ["button", 0, "swap"], ["button", 0, "reverse"], ["button", 0, "remove"], ["button", 0, "remove100"], ["button", 0, "clear"]], ["ul", 0, ""]]]);
const _template2 = _MD.createTemplateCache([["li", 0, "", ": ", ""]]);
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
export function BenchAppInline(_id, _parent, _props, _namespace, _setupOnly) {
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
  _MD.setListener(_button, "click", void 0, () => {
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
  }, _writes);
  _MD.setListener(_button2, "click", void 0, () => {
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
  }, _writes);
  _MD.setListener(_button3, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _read_data().concat(buildData(1000));
  }, _writes);
  _MD.setListener(_button4, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _MD.observeMutation([() => data], [_mutated_data]).finish(buildData(1000).concat(_read_data()));
  }, _writes);
  _MD.setListener(_button5, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _read_data().slice(0, -1000);
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
    _MD.editArray(_read_data(), "reverse", [], _mutated_data);
  }, _writes);
  _MD.setListener(_button9, "click", void 0, () => {
    _MD.editArray(_read_data(), "splice", [500, 1], _mutated_data);
  }, _writes);
  _MD.setListener(_button10, "click", void 0, () => {
    ({ get value() {
      return data;
    }, set value(_assigned) {
      data = _assigned;
      _dataVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey);
    } }).value = _read_data().filter((_item, index) => index % 100 !== 0);
  }, _writes);
  _MD.setListener(_button11, "click", void 0, () => {
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
  }, _writes);
  const _rowNamespace = _MD.renderNamespace(_text.parentNode, _namespace);
  const _rowOwner = { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace };
  const _rowList = _MD.createRowList(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace }, (item) => item.id, (item) => {
    const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace);
    const _text2 = _clone2.firstChild;
    const _node3 = _text2.nextSibling;
    const _text3 = _node3.nextSibling;
    let _value13 = _peek_selected() === item.id ? 'danger' : '';
    if (_value13 != null && _value13 !== false) {
      _clone2.setAttribute("class", _value13 === true ? "" : _MD.textValue(_value13));
    } else {
      _clone2.removeAttribute("class");
    }
    _MD.setListener(_clone2, "click", void 0, () => {
      ({ get value() {
        return selected;
      }, set value(_assigned2) {
        selected = _assigned2;
        _selectedVersion++;
        if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey2);
      } }).value = item.id;
    }, _writes);
    let _value15 = item.id;
    let _valueSlot = null;
    (_valueSlot = _MD.childSlot(_valueSlot, _text2, _value15, _rowOwner, true))?.write(_value15);
    let _value16 = item.label;
    let _valueSlot2 = null;
    (_valueSlot2 = _MD.childSlot(_valueSlot2, _text3, _value16, _rowOwner, true))?.write(_value16);
    return { node: _clone2, update(_item2) {
      item = _item2;
      const _next = _peek_selected() === item.id ? 'danger' : '';
      if (_next !== _value13 && !(_next !== _next && _value13 !== _value13)) {
        if (_next != null && _next !== false) {
          _clone2.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
        } else {
          _clone2.removeAttribute("class");
        }
        _value13 = _next;
      }
      const _next2 = item.id;
      if (_next2 !== _value15 && !(_next2 !== _next2 && _value15 !== _value15)) {
        (_valueSlot = _MD.childSlot(_valueSlot, _text2, _next2, _rowOwner, true))?.write(_next2);
        _value15 = _next2;
      }
      const _next3 = item.label;
      if (_next3 !== _value16 && !(_next3 !== _next3 && _value16 !== _value16)) {
        (_valueSlot2 = _MD.childSlot(_valueSlot2, _text3, _next3, _rowOwner, true))?.write(_next3);
        _value16 = _next3;
      }
    }, dispose() {
      if (_valueSlot !== null) _valueSlot.dispose();
      _valueSlot = _MD.disposedValueSlot;
      if (_valueSlot2 !== null) _valueSlot2.dispose();
      _valueSlot2 = _MD.disposedValueSlot;
    } };
  }, ["id"]);
  _rowList.route(_peek_selected, _version_selected, _sharedKey2);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  _rowList.map(_read_data());
  _siteComputation.end();
  _MD.cleanup(_id, () => {
    _rowList.dispose();
    _siteComputation.dispose();
  });
  function _update() {
    const _updateFrame = _scope.enter();
    if (_siteComputation.changed() || _rowList.changed()) {
      _siteComputation.begin();
      _rowList.map(_read_data());
      _siteComputation.end();
    }
    _rowList.refresh(_siteComputation);
    _scope.leave(_updateFrame);
  }
  _writes.activate();
  _scope.leave(_setupFrame);
  return _clone;
}
_completeShared(void 0);

export function createCompiledInlineApp() {
  const root = BenchAppInline('BenchAppInline', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;

  return {
    root,
    click(name: string) {
      const b = [...toolbar.children].find(
        (c) => (c as HTMLElement).textContent === name,
      ) as HTMLButtonElement;
      if (!b) throw new Error(`Button '${name}' not found in compiled inline app`);
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
