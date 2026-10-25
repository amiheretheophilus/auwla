/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
const _renderProgram = { mount(_values, _owner) {
  const _document = _MD.getActiveEnvironment().document;
  const _valueId = _owner.id;
  const _valueEntity = _owner.entity;
  const _valueWrites = _owner.batch;
  const _namespace = _owner.namespace;
  const _valueMarkup = "<li><!---->: <!----></li>";
  const _nodes = _MD.materializeMarkup(_valueMarkup);
  const _slot = _nodes[0];
  const _slot2 = _nodes[2];
  const _li = _nodes[3];
  const _text = _document.createTextNode("");
  _slot.replaceWith(_text);
  const _text2 = _document.createTextNode("");
  _slot2.replaceWith(_text2);
  let _value = _values[0];
  if (_value != null && _value !== false) {
    _li.setAttribute("class", _value === true ? "" : _MD.textValue(_value));
  } else {
    _li.removeAttribute("class");
  }
  let _value2 = _values[1];
  let _listener;
  if (_listener !== undefined) _li.removeEventListener("click", _listener);
  _listener = undefined;
  if (typeof _value2 === "function") {
    _listener = _valueWrites === null ? _value2 : _valueWrites.listener(_value2);
    _li.addEventListener("click", _listener);
  }
  let _value3 = _values[2];
  const _valueSlot = _MD.createValueSlot(_text, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace });
  _valueSlot.write(_value3);
  let _value4 = _values[3];
  const _valueSlot2 = _MD.createValueSlot(_text2, { id: _valueId, batch: _valueWrites, entity: _valueEntity, namespace: _namespace });
  _valueSlot2.write(_value4);
  return { nodes: [_li], update(_values2) {
    _values = _values2;
    const _next = _values[0];
    if (_next !== _value && !(_next !== _next && _value !== _value)) {
      if (_next != null && _next !== false) {
        _li.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
      } else {
        _li.removeAttribute("class");
      }
      _value = _next;
    }
    const _next2 = _values[1];
    if (_next2 !== _value2 && !(_next2 !== _next2 && _value2 !== _value2)) {
      if (_listener !== undefined) _li.removeEventListener("click", _listener);
      _listener = undefined;
      if (typeof _next2 === "function") {
        _listener = _valueWrites === null ? _next2 : _valueWrites.listener(_next2);
        _li.addEventListener("click", _listener);
      }
      _value2 = _next2;
    }
    const _next3 = _values[2];
    if (_next3 !== _value3 && !(_next3 !== _next3 && _value3 !== _value3)) {
      _valueSlot.write(_next3);
      _value3 = _next3;
    }
    const _next4 = _values[3];
    if (_next4 !== _value4 && !(_next4 !== _next4 && _value4 !== _value4)) {
      _valueSlot2.write(_next4);
      _value4 = _next4;
    }
  }, dispose() {
    _valueSlot.dispose();
    _valueSlot2.dispose();
  } };
} };
const _markup = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul><!----></ul></div>";
_MD.defineComponent(BenchAppInlineOwned, "./bench/dom/AppInlineOwned.tsx#BenchAppInlineOwned");
import { buildData } from './data';
export function BenchAppInlineOwned(_id, _parent, _props, _namespace2, _setupOnly) {
  let _dataVersion = 0;
  let _selectedVersion = 0;
  const _readKey = {};
  const _readKey2 = {};
  function _mutated_data() {
    _dataVersion++;
    _writes.mark();
  }
  function _write(_value5) {
    _dataVersion++;
    _writes.mark();
    return _value5;
  }
  function _write2(_value6) {
    _selectedVersion++;
    _writes.mark();
    return _value6;
  }
  const _entity = { id: _id, parent: _parent, render: _update };
  const _writes = _MD.createWriteBatch(_entity);
  const _scope = _MD.createBuildScope();
  const _setupFrame = _scope.enter();
  let data = [];
  let selected = null;
  if (_setupOnly) {
    _MD.registerEntity(_entity);
    _scope.leave(_setupFrame);
    return;
  }
  const _document2 = _MD.getActiveEnvironment().document;
  const _nodes2 = _MD.materializeMarkup(_markup);
  const _button = _nodes2[1];
  const _button2 = _nodes2[3];
  const _button3 = _nodes2[5];
  const _button4 = _nodes2[7];
  const _button5 = _nodes2[9];
  const _button6 = _nodes2[11];
  const _button7 = _nodes2[13];
  const _button8 = _nodes2[15];
  const _button9 = _nodes2[17];
  const _button10 = _nodes2[19];
  const _button11 = _nodes2[21];
  const _slot3 = _nodes2[23];
  const _div = _nodes2[25];
  const _text3 = _document2.createTextNode("");
  _slot3.replaceWith(_text3);
  let _value7 = () => {
    _write(data = buildData(1000));
    _write2(selected = null);
  };
  let _listener2;
  if (_listener2 !== undefined) _button.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value7 === "function") {
    _listener2 = _writes === null ? _value7 : _writes.listener(_value7);
    _button.addEventListener("click", _listener2);
  }
  let _value8 = () => {
    _write(data = buildData(10000));
    _write2(selected = null);
  };
  let _listener3;
  if (_listener3 !== undefined) _button2.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value8 === "function") {
    _listener3 = _writes === null ? _value8 : _writes.listener(_value8);
    _button2.addEventListener("click", _listener3);
  }
  let _value9 = () => {
    _write(data = _MD.observeMutation([() => data], [_mutated_data]).finish(_MD.trackRead(() => _dataVersion, data, _readKey).concat(buildData(1000))));
  };
  let _listener4;
  if (_listener4 !== undefined) _button3.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value9 === "function") {
    _listener4 = _writes === null ? _value9 : _writes.listener(_value9);
    _button3.addEventListener("click", _listener4);
  }
  let _value10 = () => {
    _write(data = _MD.observeMutation([() => data], [_mutated_data]).finish(buildData(1000).concat(_MD.trackRead(() => _dataVersion, data, _readKey))));
  };
  let _listener5;
  if (_listener5 !== undefined) _button4.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value10 === "function") {
    _listener5 = _writes === null ? _value10 : _writes.listener(_value10);
    _button4.addEventListener("click", _listener5);
  }
  let _value11 = () => {
    _write(data = _MD.observeMutation([() => data], [_mutated_data]).finish(_MD.trackRead(() => _dataVersion, data, _readKey).slice(0, -1000)));
  };
  let _listener6;
  if (_listener6 !== undefined) _button5.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value11 === "function") {
    _listener6 = _writes === null ? _value11 : _writes.listener(_value11);
    _button5.addEventListener("click", _listener6);
  }
  let _value12 = () => {
    for (let i = 0; i < _MD.trackRead(() => _dataVersion, data, _readKey).length; i += 10) _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey)[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener7;
  if (_listener7 !== undefined) _button6.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value12 === "function") {
    _listener7 = _writes === null ? _value12 : _writes.listener(_value12);
    _button6.addEventListener("click", _listener7);
  }
  let _value13 = () => {
    if (_MD.trackRead(() => _dataVersion, data, _readKey).length > 998) {
      const t = _MD.trackRead(() => _dataVersion, data, _readKey)[1];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 1, _mutated_data).value = _MD.trackRead(() => _dataVersion, data, _readKey)[998];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 998, _mutated_data).value = t;
    }
  };
  let _listener8;
  if (_listener8 !== undefined) _button7.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value13 === "function") {
    _listener8 = _writes === null ? _value13 : _writes.listener(_value13);
    _button7.addEventListener("click", _listener8);
  }
  let _value14 = () => {
    _MD.observeMutation([() => data], [_mutated_data]).finish(_MD.trackRead(() => _dataVersion, data, _readKey).reverse());
  };
  let _listener9;
  if (_listener9 !== undefined) _button8.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value14 === "function") {
    _listener9 = _writes === null ? _value14 : _writes.listener(_value14);
    _button8.addEventListener("click", _listener9);
  }
  let _value15 = () => {
    _MD.observeMutation([() => data], [_mutated_data]).finish(_MD.trackRead(() => _dataVersion, data, _readKey).splice(500, 1));
  };
  let _listener10;
  if (_listener10 !== undefined) _button9.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value15 === "function") {
    _listener10 = _writes === null ? _value15 : _writes.listener(_value15);
    _button9.addEventListener("click", _listener10);
  }
  let _value16 = () => {
    _write(data = _MD.observeMutation([() => data], [_mutated_data]).finish(_MD.trackRead(() => _dataVersion, data, _readKey).filter((_item, index) => index % 100 !== 0)));
  };
  let _listener11;
  if (_listener11 !== undefined) _button10.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value16 === "function") {
    _listener11 = _writes === null ? _value16 : _writes.listener(_value16);
    _button10.addEventListener("click", _listener11);
  }
  let _value17 = () => {
    _write(data = []);
    _write2(selected = null);
  };
  let _listener12;
  if (_listener12 !== undefined) _button11.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value17 === "function") {
    _listener12 = _writes === null ? _value17 : _writes.listener(_value17);
    _button11.addEventListener("click", _listener12);
  }
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  let _value18 = _MD.observeMutation([() => data], [_mutated_data]).finish(data.map((item) => (_MD.createRenderValue(_renderProgram, [_MD.trackRead(() => _selectedVersion, selected, _readKey2) === item.id ? 'danger' : '', () => {
    _write2(selected = item.id);
  }, item.id, item.label], item.id))));
  _siteComputation.end();
  const _valueSlot3 = _MD.createValueSlot(_text3, { id: _id, batch: _writes, entity: _entity, namespace: _namespace2 });
  _valueSlot3.write(_value18);
  let _seen = _dataVersion;
  let _publishedVersion = _dataVersion;
  let _publishedVersion2 = _selectedVersion;
  _MD.cleanup(_id, () => {
    _siteComputation.dispose();
    _valueSlot3.dispose();
  });
  _MD.watchMutationRoots(_entity, [{ read: () => data, notify: () => {
    _dataVersion++;
    if (!_scope.building()) _writes.mark();
  } }, { read: () => selected, notify: () => {
    _selectedVersion++;
    if (!_scope.building()) _writes.mark();
  } }]);
  function _update() {
    const _updateFrame = _scope.enter();
    if (_dataVersion !== _seen || _siteComputation.changed()) {
      _siteComputation.begin();
      const _next5 = _MD.observeMutation([() => data], [_mutated_data]).finish(data.map((item) => (_MD.createRenderValue(_renderProgram, [_MD.trackRead(() => _selectedVersion, selected, _readKey2) === item.id ? 'danger' : '', () => {
        _write2(selected = item.id);
      }, item.id, item.label], item.id))));
      _siteComputation.end();
      if (_next5 !== _value18 && !(_next5 !== _next5 && _value18 !== _value18)) {
        _valueSlot3.write(_next5);
        _value18 = _next5;
      }
      _seen = _dataVersion;
    }
    if (_publishedVersion !== _dataVersion) {
      _publishedVersion = _dataVersion;
      _MD.publishVersions([_readKey]);
    }
    if (_publishedVersion2 !== _selectedVersion) {
      _publishedVersion2 = _selectedVersion;
      _MD.publishVersions([_readKey2]);
    }
    _scope.leave(_updateFrame);
  }
  _MD.registerEntity(_entity);
  _writes.activate();
  _scope.leave(_setupFrame);
  return _div;
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
