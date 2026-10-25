/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
const _markup = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul><!----></ul></div>";
_MD.defineComponent(BenchApp, "./bench/dom/App.tsx#BenchApp");
const _markup2 = "<li><!---->: <!----></li>";
_MD.defineComponent(Row, "./bench/dom/App.tsx#Row");
let _dataVersion = 0;
const _sharedKey = {};
function _read_data() {
  if (_MD.isBuilding() && _sharedReady && !_sharedScope.active()) _refreshShared();
  return _MD.trackRead(() => {
    if (_MD.isBuilding() && _sharedReady && !_sharedScope.active()) _refreshShared();
    return _dataVersion;
  }, data, _sharedKey);
}
export { _read_data };
let _selectedVersion = 0;
const _sharedKey2 = {};
function _read_selected() {
  if (_MD.isBuilding() && _sharedReady && !_sharedScope.active()) _refreshShared();
  return _MD.trackRead(() => {
    if (_MD.isBuilding() && _sharedReady && !_sharedScope.active()) _refreshShared();
    return _selectedVersion;
  }, selected, _sharedKey2);
}
export { _read_selected };
const _sharedScope = _MD.createBuildScope(true, false);
let _sharedReady = false;
const _sharedWrites = _MD.createSharedWrites([_sharedKey, _sharedKey2], []);
function _mutated() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated2() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated3() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated4() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated5() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated6() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated7() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated8() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated9() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _mutated10() {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
}
function _completeShared2(_result2) {
  _sharedReady = true;
  _sharedScope.leave(_sharedFrame);
  return _result2;
}
function _refreshShared() {
  if (!_sharedReady || _sharedScope.active()) return;
  const _sharedFrame = _sharedScope.enter();
  _sharedScope.leave(_sharedFrame);
}
const _sharedFrame = _sharedScope.enter();
import { buildData } from './data';
let data = [];
_sharedWrites.watch([{ read: () => data, notify: () => {
  _dataVersion++;
  _sharedWrites.mark(_sharedKey);
} }]);
let selected = null;
_sharedWrites.watch([{ read: () => selected, notify: () => {
  _selectedVersion++;
  _sharedWrites.mark(_sharedKey2);
} }]);
function Row(_id2, _parent2, _props2, _namespace2, _setupOnly2) {
  let _propsVersion = 0;
  const _readKey = {};
  const _entity2 = { id: _id2, parent: _parent2, render: _update2 };
  const _writes2 = _MD.createWriteBatch(_entity2);
  const _scope2 = _MD.createBuildScope();
  const _setupFrame2 = _scope2.enter();
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
    _MD.registerEntity(_entity2);
    _scope2.leave(_setupFrame2);
    return;
  }
  const _document2 = _MD.getActiveEnvironment().document;
  const _nodes2 = _MD.materializeMarkup(_markup2);
  const _slot2 = _nodes2[0];
  const _slot3 = _nodes2[2];
  const _li = _nodes2[3];
  const _text2 = _document2.createTextNode("");
  _slot2.replaceWith(_text2);
  const _text3 = _document2.createTextNode("");
  _slot3.replaceWith(_text3);
  const _siteComputation2 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation2.begin();
  let _value13 = _read_selected() === props.item.id ? 'danger' : '';
  _siteComputation2.end();
  if (_value13 != null && _value13 !== false) {
    _li.setAttribute("class", _value13 === true ? "" : _MD.textValue(_value13));
  } else {
    _li.removeAttribute("class");
  }
  let _seen = _propsVersion;
  let _value14 = () => {
    ({ get value() {
      return selected;
    }, set value(_assigned2) {
      selected = _assigned2;
      _selectedVersion++;
      if (!_sharedScope.building()) _sharedWrites.mark(_sharedKey2);
    } }).value = _MD.trackRead(() => _propsVersion, props, _readKey).item.id;
  };
  let _listener12;
  if (_listener12 !== undefined) _li.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value14 === "function") {
    _listener12 = _writes2 === null ? _value14 : _writes2.listener(_value14);
    _li.addEventListener("click", _listener12);
  }
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _value15 = props.item.id;
  _siteComputation3.end();
  const _valueSlot2 = _MD.createValueSlot(_text2, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 });
  _valueSlot2.write(_value15);
  let _seen2 = _propsVersion;
  const _siteComputation4 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation4.begin();
  let _value16 = props.item.label;
  _siteComputation4.end();
  const _valueSlot3 = _MD.createValueSlot(_text3, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace2 });
  _valueSlot3.write(_value16);
  let _seen3 = _propsVersion;
  let _publishedVersion = _propsVersion;
  _MD.cleanup(_id2, () => {
    _siteComputation2.dispose();
    _siteComputation3.dispose();
    _valueSlot2.dispose();
    _siteComputation4.dispose();
    _valueSlot3.dispose();
  });
  _MD.watchMutationRoots(_entity2, []);
  function _update2() {
    const _updateFrame2 = _scope2.enter();
    if (_propsVersion !== _seen || _siteComputation2.changed()) {
      _siteComputation2.begin();
      const _next2 = _read_selected() === props.item.id ? 'danger' : '';
      _siteComputation2.end();
      if (_next2 !== _value13 && !(_next2 !== _next2 && _value13 !== _value13)) {
        if (_next2 != null && _next2 !== false) {
          _li.setAttribute("class", _next2 === true ? "" : _MD.textValue(_next2));
        } else {
          _li.removeAttribute("class");
        }
        _value13 = _next2;
      }
      _seen = _propsVersion;
    }
    if (_propsVersion !== _seen2 || _siteComputation3.changed()) {
      _siteComputation3.begin();
      const _next3 = props.item.id;
      _siteComputation3.end();
      if (_next3 !== _value15 && !(_next3 !== _next3 && _value15 !== _value15)) {
        _valueSlot2.write(_next3);
        _value15 = _next3;
      }
      _seen2 = _propsVersion;
    }
    if (_propsVersion !== _seen3 || _siteComputation4.changed()) {
      _siteComputation4.begin();
      const _next4 = props.item.label;
      _siteComputation4.end();
      if (_next4 !== _value16 && !(_next4 !== _next4 && _value16 !== _value16)) {
        _valueSlot3.write(_next4);
        _value16 = _next4;
      }
      _seen3 = _propsVersion;
    }
    if (_publishedVersion !== _propsVersion) {
      _publishedVersion = _propsVersion;
      _MD.publishVersions([_readKey]);
    }
    _scope2.leave(_updateFrame2);
  }
  _MD.registerEntity(_entity2);
  _writes2.activate();
  _scope2.leave(_setupFrame2);
  return _li;
}
export function BenchApp(_id, _parent, _props, _namespace, _setupOnly) {
  const _entity = { id: _id, parent: _parent, render: _update };
  const _writes = _MD.createWriteBatch(_entity);
  const _scope = _MD.createBuildScope();
  const _setupFrame = _scope.enter();
  if (_setupOnly) {
    _MD.registerEntity(_entity);
    _scope.leave(_setupFrame);
    return;
  }
  const _document = _MD.getActiveEnvironment().document;
  const _nodes = _MD.materializeMarkup(_markup);
  const _button = _nodes[1];
  const _button2 = _nodes[3];
  const _button3 = _nodes[5];
  const _button4 = _nodes[7];
  const _button5 = _nodes[9];
  const _button6 = _nodes[11];
  const _button7 = _nodes[13];
  const _button8 = _nodes[15];
  const _button9 = _nodes[17];
  const _button10 = _nodes[19];
  const _button11 = _nodes[21];
  const _slot = _nodes[23];
  const _div = _nodes[25];
  const _text = _document.createTextNode("");
  _slot.replaceWith(_text);
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
    } }).value = _MD.observeMutation([() => data], [_mutated7]).finish(_read_data().concat(buildData(1000)));
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
    } }).value = _MD.observeMutation([() => data], [_mutated8]).finish(buildData(1000).concat(_read_data()));
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
    } }).value = _MD.observeMutation([() => data], [_mutated4]).finish(_read_data().slice(0, -1000));
  };
  let _listener5;
  if (_listener5 !== undefined) _button5.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value5 === "function") {
    _listener5 = _writes === null ? _value5 : _writes.listener(_value5);
    _button5.addEventListener("click", _listener5);
  }
  let _value6 = () => {
    for (let i = 0; i < _read_data().length; i += 10) _MD.mutationTarget(_read_data()[i], "label", _mutated6).value += ' !!!';
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
      let _tVersion = 0;
      const _sharedKey3 = {};
      function _read_t() {
        if (_MD.isBuilding() && _sharedReady2 && !_sharedScope2.active()) _refreshShared2();
        return _MD.trackRead(() => {
          if (_MD.isBuilding() && _sharedReady2 && !_sharedScope2.active()) _refreshShared2();
          return _tVersion;
        }, t, _sharedKey3);
      }
      const _sharedScope2 = _MD.createBuildScope(true, true);
      let _sharedReady2 = false;
      const _sharedWrites2 = _MD.createSharedWrites([_sharedKey3], [_sharedKey3]);
      function _completeShared(_result) {
        _sharedReady2 = true;
        _sharedScope2.leave(_sharedFrame2);
        return _result;
      }
      function _refreshShared2() {
        if (!_sharedReady2 || _sharedScope2.active()) return;
        const _sharedFrame2 = _sharedScope2.enter();
        let _recompute = false || _computation.changed();
        if (_recompute && (false || true)) {
          _computation.begin(true);
          (t = _read_data()[1]);
          _tVersion++;
          _computation.end(true);
        }
        _sharedScope2.leave(_sharedFrame2);
      }
      const _sharedFrame2 = _sharedScope2.enter(() => _completeShared(void 0));
      const _computation = _MD.createComputation(_sharedWrites2.mark);
      _computation.begin(true);
      let t = _read_data()[1];
      _sharedWrites2.watch([{ read: () => t, notify: () => {
        _tVersion++;
        _sharedWrites2.mark(_sharedKey3);
      } }]);
      _computation.end(true);
      _MD.mutationTarget(_read_data(), 1, _mutated5).value = _read_data()[998];
      _MD.mutationTarget(_read_data(), 998, _mutated).value = _read_t();
      _completeShared(void 0);
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
    _MD.observeMutation([() => data], [_mutated2]).finish(_read_data().reverse());
  };
  let _listener8;
  if (_listener8 !== undefined) _button8.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value8 === "function") {
    _listener8 = _writes === null ? _value8 : _writes.listener(_value8);
    _button8.addEventListener("click", _listener8);
  }
  let _value9 = () => {
    _MD.observeMutation([() => data], [_mutated3]).finish(_read_data().splice(500, 1));
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
    } }).value = _MD.observeMutation([() => data], [_mutated9]).finish(_read_data().filter((_item, index) => index % 100 !== 0));
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
  const _siteComputation = _MD.createComputation(_writes.mark, _entity);
  _siteComputation.begin();
  let _value12 = _MD.observeMutation([() => data], [_mutated10]).finish(_read_data().map((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item }))));
  _siteComputation.end();
  const _valueSlot = _MD.createValueSlot(_text, { id: _id, batch: _writes, entity: _entity, namespace: _namespace });
  _valueSlot.write(_value12);
  _MD.cleanup(_id, () => {
    _siteComputation.dispose();
    _valueSlot.dispose();
  });
  _MD.watchMutationRoots(_entity, []);
  function _update() {
    const _updateFrame = _scope.enter();
    if (_siteComputation.changed()) {
      _siteComputation.begin();
      const _next = _MD.observeMutation([() => data], [_mutated10]).finish(_read_data().map((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item }))));
      _siteComputation.end();
      if (_next !== _value12 && !(_next !== _next && _value12 !== _value12)) {
        _valueSlot.write(_next);
        _value12 = _next;
      }
    }
    _scope.leave(_updateFrame);
  }
  _MD.registerEntity(_entity);
  _writes.activate();
  _scope.leave(_setupFrame);
  return _div;
}
_completeShared2(void 0);

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
