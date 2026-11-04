/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
_MD.defineComponent(BenchAppInlineOwned, "./bench/dom/AppInlineOwned.tsx#BenchAppInlineOwned");
const _template = _MD.createTemplateCache([["div", 0, ["div", ["class", "toolbar"], ["button", 0, "create1k"], ["button", 0, "create10k"], ["button", 0, "append1k"], ["button", 0, "prepend1k"], ["button", 0, "pop1k"], ["button", 0, "update"], ["button", 0, "swap"], ["button", 0, "reverse"], ["button", 0, "remove"], ["button", 0, "remove100"], ["button", 0, "clear"]], ["ul", 0, ""]]]);
const _template2 = _MD.createTemplateCache([["li", 0, "", ": ", ""]]);
import { buildData } from './data';
export function BenchAppInlineOwned(_id, _parent, _props, _namespace, _setupOnly) {
  let _dataVersion = 0;
  let _selectedVersion = 0;
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
    _write(data = buildData(1000));
    _write2(selected = null);
  }, _writes);
  _MD.setListener(_button2, "click", void 0, () => {
    _write(data = buildData(10000));
    _write2(selected = null);
  }, _writes);
  _MD.setListener(_button3, "click", void 0, () => {
    _write(data = _MD.trackRead(() => _dataVersion, data, _readKey).concat(buildData(1000)));
  }, _writes);
  _MD.setListener(_button4, "click", void 0, () => {
    _write(data = _MD.observeMutation([() => data], [_mutated_data]).finish(buildData(1000).concat(_MD.trackRead(() => _dataVersion, data, _readKey))));
  }, _writes);
  _MD.setListener(_button5, "click", void 0, () => {
    _write(data = _MD.trackRead(() => _dataVersion, data, _readKey).slice(0, -1000));
  }, _writes);
  _MD.setListener(_button6, "click", void 0, () => {
    for (let i = 0; i < _MD.trackRead(() => _dataVersion, data, _readKey).length; i += 10) _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey)[i], "label", _mutated_data).value += ' !!!';
  }, _writes);
  _MD.setListener(_button7, "click", void 0, () => {
    if (_MD.trackRead(() => _dataVersion, data, _readKey).length > 998) {
      const t = _MD.trackRead(() => _dataVersion, data, _readKey)[1];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 1, _mutated_data).value = _MD.trackRead(() => _dataVersion, data, _readKey)[998];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 998, _mutated_data).value = t;
    }
  }, _writes);
  _MD.setListener(_button8, "click", void 0, () => {
    _MD.editArray(_MD.trackRead(() => _dataVersion, data, _readKey), "reverse", [], _mutated_data);
  }, _writes);
  _MD.setListener(_button9, "click", void 0, () => {
    _MD.editArray(_MD.trackRead(() => _dataVersion, data, _readKey), "splice", [500, 1], _mutated_data);
  }, _writes);
  _MD.setListener(_button10, "click", void 0, () => {
    _write(data = _MD.trackRead(() => _dataVersion, data, _readKey).filter((_item, index) => index % 100 !== 0));
  }, _writes);
  _MD.setListener(_button11, "click", void 0, () => {
    _write(data = []);
    _write2(selected = null);
  }, _writes);
  const _rowNamespace = _MD.renderNamespace(_text.parentNode, _namespace);
  const _rowOwner = { id: _id, batch: _writes, entity: _entity, namespace: _rowNamespace };
  const _rowList = _MD.createRowList(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace }, (item) => item.id, (item) => {
    const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace);
    const _text2 = _clone2.firstChild;
    const _node3 = _text2.nextSibling;
    const _text3 = _node3.nextSibling;
    let _value15 = selected === item.id ? 'danger' : '';
    if (_value15 != null && _value15 !== false) {
      _clone2.setAttribute("class", _value15 === true ? "" : _MD.textValue(_value15));
    } else {
      _clone2.removeAttribute("class");
    }
    _MD.setListener(_clone2, "click", void 0, () => {
      _write2(selected = item.id);
    }, _writes);
    let _value17 = item.id;
    let _valueSlot = null;
    (_valueSlot = _MD.childSlot(_valueSlot, _text2, _value17, _rowOwner, true))?.write(_value17);
    let _value18 = item.label;
    let _valueSlot2 = null;
    (_valueSlot2 = _MD.childSlot(_valueSlot2, _text3, _value18, _rowOwner, true))?.write(_value18);
    return { node: _clone2, update(_item2) {
      item = _item2;
      const _next = selected === item.id ? 'danger' : '';
      if (_next !== _value15 && !(_next !== _next && _value15 !== _value15)) {
        if (_next != null && _next !== false) {
          _clone2.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
        } else {
          _clone2.removeAttribute("class");
        }
        _value15 = _next;
      }
      const _next2 = item.id;
      if (_next2 !== _value17 && !(_next2 !== _next2 && _value17 !== _value17)) {
        (_valueSlot = _MD.childSlot(_valueSlot, _text2, _next2, _rowOwner, true))?.write(_next2);
        _value17 = _next2;
      }
      const _next3 = item.label;
      if (_next3 !== _value18 && !(_next3 !== _next3 && _value18 !== _value18)) {
        (_valueSlot2 = _MD.childSlot(_valueSlot2, _text3, _next3, _rowOwner, true))?.write(_next3);
        _value18 = _next3;
      }
    }, dispose() {
      if (_valueSlot !== null) _valueSlot.dispose();
      _valueSlot = _MD.disposedValueSlot;
      if (_valueSlot2 !== null) _valueSlot2.dispose();
      _valueSlot2 = _MD.disposedValueSlot;
    } };
  }, ["id"]);
  _rowList.route(() => selected, () => _selectedVersion, void 0);
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  _rowList.map(data);
  _siteComputation.end();
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

export function createCompiledInlineOwnedApp() {
  const root = BenchAppInlineOwned('BenchAppInlineOwned', null) as HTMLElement;
  const toolbar = root.querySelector('.toolbar') as HTMLElement;
  const ul = root.querySelector('ul') as HTMLElement;
  return {
    root,
    click(name: string) {
      const button = [...toolbar.children].find(child => child.textContent === name) as HTMLButtonElement;
      if (!button) throw new Error(`Button '${name}' not found in AppInlineOwned`);
      button.click();
    },
    selectRow(index: number) { (ul.children[index] as HTMLElement).click(); },
    rowCount() { return ul.children.length; },
  };
}
