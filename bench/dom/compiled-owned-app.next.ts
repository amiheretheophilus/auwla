/* oxlint-disable no-unused-expressions -- compiler-generated mutation sequences */
import * as _MD from "@memoized-dom/runtime";
const _markup = "<div><div class=\"toolbar\"><button>create1k</button><button>create10k</button><button>append1k</button><button>prepend1k</button><button>pop1k</button><button>update</button><button>swap</button><button>reverse</button><button>remove</button><button>remove100</button><button>clear</button></div><ul><!----></ul></div>";
_MD.defineComponent(BenchAppOwned, "./bench/dom/AppOwned.tsx#BenchAppOwned");
const _markup2 = "<li><!---->: <!----></li>";
_MD.defineComponent(Row, "./bench/dom/AppOwned.tsx#Row");
function _Row_row(props, _rowOwner2) {
  const _document3 = _MD.getActiveEnvironment().document;
  const _rowId = _rowOwner2.id;
  const _rowWrites = _rowOwner2.batch;
  const _rowEntity = _rowOwner2.entity;
  const _rowNamespace2 = _rowOwner2.namespace;
  const _invalidate = _rowOwner2.invalidate;
  const _rowMarkup = "<li><!---->: <!----></li>";
  let _text3, _text4, _li2;
  const _clone2 = _MD.cloneTemplate(_template2, _rowNamespace2, _buildTemplate2);
  if (_clone2 !== null) {
    const _node16 = _clone2;
    const _node17 = _node16.firstChild;
    _text3 = _node17;
    const _node18 = _node17.nextSibling;
    const _node19 = _node18.nextSibling;
    _text4 = _node19;
    _li2 = _node16;
  } else {
    const _nodes2 = _rowNamespace2 === "svg" ? (() => {
      const _slot6 = _document3.createComment("");
      const _static24 = _document3.createTextNode(": ");
      const _slot7 = _document3.createComment("");
      const _li3 = _document3.createElementNS("http://www.w3.org/2000/svg", "li");
      _li3.append(_slot6, _static24, _slot7);
      return [_slot6, _static24, _slot7, _li3];
    })() : _MD.materializeMarkup(_rowMarkup);
    const _slot8 = _nodes2[0];
    const _slot9 = _nodes2[2];
    const _li4 = _nodes2[3];
    const _text5 = _document3.createTextNode("");
    _slot8.replaceWith(_text5);
    const _text6 = _document3.createTextNode("");
    _slot9.replaceWith(_text6);
    _text3 = _text5;
    _text4 = _text6;
    _li2 = _li4;
  }
  let _value15 = props.selected ? 'danger' : '';
  if (_value15 != null && _value15 !== false) {
    _li2.setAttribute("class", _value15 === true ? "" : _MD.textValue(_value15));
  } else {
    _li2.removeAttribute("class");
  }
  let _value16 = () => {
    _MD.observeMethod([() => props], [_invalidate], props, "select", 0, void 0)(props.item.id);
  };
  let _listener12;
  if (_listener12 !== undefined) _li2.removeEventListener("click", _listener12);
  _listener12 = undefined;
  if (typeof _value16 === "function") {
    _listener12 = _rowWrites === null ? _value16 : _rowWrites.listener(_value16);
    _li2.addEventListener("click", _listener12);
  }
  let _value17 = props.item.id;
  let _valueSlot = null;
  if (_valueSlot === null && (_value17 === null || typeof _value17 !== "object")) {
    _MD.setTextData(_text3, _value17);
  } else {
    (_valueSlot ??= _MD.createIndexedValueSlot(_text3, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_value17);
  }
  let _value18 = props.item.label;
  let _valueSlot2 = null;
  if (_valueSlot2 === null && (_value18 === null || typeof _value18 !== "object")) {
    _MD.setTextData(_text4, _value18);
  } else {
    (_valueSlot2 ??= _MD.createIndexedValueSlot(_text4, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_value18);
  }
  return { node: _li2, update(_nextProps) {
    if (!_MD.sameProps(props, _nextProps)) props = _nextProps;
    const _next = props.selected ? 'danger' : '';
    if (_next !== _value15 && !(_next !== _next && _value15 !== _value15)) {
      if (_next != null && _next !== false) {
        _li2.setAttribute("class", _next === true ? "" : _MD.textValue(_next));
      } else {
        _li2.removeAttribute("class");
      }
      _value15 = _next;
    }
    const _next2 = props.item.id;
    if (_next2 !== _value17 && !(_next2 !== _next2 && _value17 !== _value17)) {
      if (_valueSlot === null && (_next2 === null || typeof _next2 !== "object")) {
        _MD.setTextData(_text3, _next2);
      } else {
        (_valueSlot ??= _MD.createIndexedValueSlot(_text3, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_next2);
      }
      _value17 = _next2;
    }
    const _next3 = props.item.label;
    if (_next3 !== _value18 && !(_next3 !== _next3 && _value18 !== _value18)) {
      if (_valueSlot2 === null && (_next3 === null || typeof _next3 !== "object")) {
        _MD.setTextData(_text4, _next3);
      } else {
        (_valueSlot2 ??= _MD.createIndexedValueSlot(_text4, { id: _rowId, batch: _rowWrites, entity: _rowEntity, namespace: _rowNamespace2 })).write(_next3);
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
const _template = _MD.createTemplateCache();
function _buildTemplate(_document2, _namespace2) {
  const _static = _document2.createTextNode("create1k");
  const _button = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button.append(_static);
  const _static2 = _document2.createTextNode("create10k");
  const _button2 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button2.append(_static2);
  const _static3 = _document2.createTextNode("append1k");
  const _button3 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button3.append(_static3);
  const _static4 = _document2.createTextNode("prepend1k");
  const _button4 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button4.append(_static4);
  const _static5 = _document2.createTextNode("pop1k");
  const _button5 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button5.append(_static5);
  const _static6 = _document2.createTextNode("update");
  const _button6 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button6.append(_static6);
  const _static7 = _document2.createTextNode("swap");
  const _button7 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button7.append(_static7);
  const _static8 = _document2.createTextNode("reverse");
  const _button8 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button8.append(_static8);
  const _static9 = _document2.createTextNode("remove");
  const _button9 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button9.append(_static9);
  const _static10 = _document2.createTextNode("remove100");
  const _button10 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button10.append(_static10);
  const _static11 = _document2.createTextNode("clear");
  const _button11 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "button") : _document2.createElement("button");
  _button11.append(_static11);
  const _div = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "div") : _document2.createElement("div");
  _div.setAttribute("class", "toolbar");
  _div.append(_button, _button2, _button3, _button4, _button5, _button6, _button7, _button8, _button9, _button10, _button11);
  const _slot = _document2.createTextNode("");
  const _ul = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "ul") : _document2.createElement("ul");
  _ul.append(_slot);
  const _div2 = _namespace2 === "svg" ? _document2.createElementNS("http://www.w3.org/2000/svg", "div") : _document2.createElement("div");
  _div2.append(_div, _ul);
  return _div2;
}
const _template2 = _MD.createTemplateCache();
function _buildTemplate2(_document4, _namespace3) {
  const _slot4 = _document4.createTextNode("");
  const _static23 = _document4.createTextNode(": ");
  const _slot5 = _document4.createTextNode("");
  const _li = _namespace3 === "svg" ? _document4.createElementNS("http://www.w3.org/2000/svg", "li") : _document4.createElement("li");
  _li.append(_slot4, _static23, _slot5);
  return _li;
}
const _template3 = _MD.createTemplateCache();
function _buildTemplate3(_document6, _namespace5) {
  const _slot10 = _document6.createTextNode("");
  const _static25 = _document6.createTextNode(": ");
  const _slot11 = _document6.createTextNode("");
  const _li5 = _namespace5 === "svg" ? _document6.createElementNS("http://www.w3.org/2000/svg", "li") : _document6.createElement("li");
  _li5.append(_slot10, _static25, _slot11);
  return _li5;
}
import { buildData } from './data';
function Row(_id2, _parent2, _props2, _namespace4, _setupOnly2) {
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
  const _document5 = _MD.getActiveEnvironment().document;
  let _text7, _text8, _li6;
  const _clone3 = _MD.cloneTemplate(_template3, _namespace4, _buildTemplate3);
  if (_clone3 !== null) {
    const _node20 = _clone3;
    const _node21 = _node20.firstChild;
    _text7 = _node21;
    const _node22 = _node21.nextSibling;
    const _node23 = _node22.nextSibling;
    _text8 = _node23;
    _li6 = _node20;
  } else {
    const _nodes3 = _namespace4 === "svg" ? (() => {
      const _slot12 = _document5.createComment("");
      const _static26 = _document5.createTextNode(": ");
      const _slot13 = _document5.createComment("");
      const _li7 = _document5.createElementNS("http://www.w3.org/2000/svg", "li");
      _li7.append(_slot12, _static26, _slot13);
      return [_slot12, _static26, _slot13, _li7];
    })() : _MD.materializeMarkup(_markup2);
    const _slot14 = _nodes3[0];
    const _slot15 = _nodes3[2];
    const _li8 = _nodes3[3];
    const _text9 = _document5.createTextNode("");
    _slot14.replaceWith(_text9);
    const _text10 = _document5.createTextNode("");
    _slot15.replaceWith(_text10);
    _text7 = _text9;
    _text8 = _text10;
    _li6 = _li8;
  }
  const _siteComputation2 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation2.begin();
  let _value19 = props.selected ? 'danger' : '';
  _siteComputation2.end();
  if (_value19 != null && _value19 !== false) {
    _li6.setAttribute("class", _value19 === true ? "" : _MD.textValue(_value19));
  } else {
    _li6.removeAttribute("class");
  }
  let _seen2 = _propsVersion;
  let _value20 = () => {
    _MD.observeMethod([() => props], [_mutated_props], _MD.trackRead(() => _propsVersion, props, _readKey3), "select", 0, void 0)(_MD.trackRead(() => _propsVersion, props, _readKey3).item.id);
  };
  let _listener13;
  if (_listener13 !== undefined) _li6.removeEventListener("click", _listener13);
  _listener13 = undefined;
  if (typeof _value20 === "function") {
    _listener13 = _writes2 === null ? _value20 : _writes2.listener(_value20);
    _li6.addEventListener("click", _listener13);
  }
  const _siteComputation3 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation3.begin();
  let _value21 = props.item.id;
  _siteComputation3.end();
  let _valueSlot3 = null;
  if (_valueSlot3 === null && (_value21 === null || typeof _value21 !== "object")) {
    _MD.setTextData(_text7, _value21);
  } else {
    (_valueSlot3 ??= _MD.createIndexedValueSlot(_text7, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace4 })).write(_value21);
  }
  let _seen3 = _propsVersion;
  const _siteComputation4 = _MD.createComputation(_writes2.mark, _entity2);
  _siteComputation4.begin();
  let _value22 = props.item.label;
  _siteComputation4.end();
  let _valueSlot4 = null;
  if (_valueSlot4 === null && (_value22 === null || typeof _value22 !== "object")) {
    _MD.setTextData(_text8, _value22);
  } else {
    (_valueSlot4 ??= _MD.createIndexedValueSlot(_text8, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace4 })).write(_value22);
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
          _li6.setAttribute("class", _next5 === true ? "" : _MD.textValue(_next5));
        } else {
          _li6.removeAttribute("class");
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
          _MD.setTextData(_text7, _next6);
        } else {
          (_valueSlot3 ??= _MD.createIndexedValueSlot(_text7, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace4 })).write(_next6);
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
          _MD.setTextData(_text8, _next7);
        } else {
          (_valueSlot4 ??= _MD.createIndexedValueSlot(_text8, { id: _id2, batch: _writes2, entity: _entity2, namespace: _namespace4 })).write(_next7);
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
  return _li6;
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
  let _button12, _button13, _button14, _button15, _button16, _button17, _button18, _button19, _button20, _button21, _button22, _text, _div3;
  const _clone = _MD.cloneTemplate(_template, _namespace, _buildTemplate);
  if (_clone !== null) {
    const _node = _clone;
    const _node2 = _node.firstChild;
    const _node3 = _node2.firstChild;
    _button12 = _node3;
    const _node4 = _node3.nextSibling;
    _button13 = _node4;
    const _node5 = _node4.nextSibling;
    _button14 = _node5;
    const _node6 = _node5.nextSibling;
    _button15 = _node6;
    const _node7 = _node6.nextSibling;
    _button16 = _node7;
    const _node8 = _node7.nextSibling;
    _button17 = _node8;
    const _node9 = _node8.nextSibling;
    _button18 = _node9;
    const _node10 = _node9.nextSibling;
    _button19 = _node10;
    const _node11 = _node10.nextSibling;
    _button20 = _node11;
    const _node12 = _node11.nextSibling;
    _button21 = _node12;
    const _node13 = _node12.nextSibling;
    _button22 = _node13;
    const _node14 = _node2.nextSibling;
    const _node15 = _node14.firstChild;
    _text = _node15;
    _div3 = _node;
  } else {
    const _nodes = _namespace === "svg" ? (() => {
      const _static12 = _document.createTextNode("create1k");
      const _button23 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button23.append(_static12);
      const _static13 = _document.createTextNode("create10k");
      const _button24 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button24.append(_static13);
      const _static14 = _document.createTextNode("append1k");
      const _button25 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button25.append(_static14);
      const _static15 = _document.createTextNode("prepend1k");
      const _button26 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button26.append(_static15);
      const _static16 = _document.createTextNode("pop1k");
      const _button27 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button27.append(_static16);
      const _static17 = _document.createTextNode("update");
      const _button28 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button28.append(_static17);
      const _static18 = _document.createTextNode("swap");
      const _button29 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button29.append(_static18);
      const _static19 = _document.createTextNode("reverse");
      const _button30 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button30.append(_static19);
      const _static20 = _document.createTextNode("remove");
      const _button31 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button31.append(_static20);
      const _static21 = _document.createTextNode("remove100");
      const _button32 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button32.append(_static21);
      const _static22 = _document.createTextNode("clear");
      const _button33 = _document.createElementNS("http://www.w3.org/2000/svg", "button");
      _button33.append(_static22);
      const _div4 = _document.createElementNS("http://www.w3.org/2000/svg", "div");
      _div4.setAttribute("class", "toolbar");
      _div4.append(_button23, _button24, _button25, _button26, _button27, _button28, _button29, _button30, _button31, _button32, _button33);
      const _slot2 = _document.createComment("");
      const _ul2 = _document.createElementNS("http://www.w3.org/2000/svg", "ul");
      _ul2.append(_slot2);
      const _div5 = _document.createElementNS("http://www.w3.org/2000/svg", "div");
      _div5.append(_div4, _ul2);
      return [_static12, _button23, _static13, _button24, _static14, _button25, _static15, _button26, _static16, _button27, _static17, _button28, _static18, _button29, _static19, _button30, _static20, _button31, _static21, _button32, _static22, _button33, _div4, _slot2, _ul2, _div5];
    })() : _MD.materializeMarkup(_markup);
    const _button34 = _nodes[1];
    const _button35 = _nodes[3];
    const _button36 = _nodes[5];
    const _button37 = _nodes[7];
    const _button38 = _nodes[9];
    const _button39 = _nodes[11];
    const _button40 = _nodes[13];
    const _button41 = _nodes[15];
    const _button42 = _nodes[17];
    const _button43 = _nodes[19];
    const _button44 = _nodes[21];
    const _slot3 = _nodes[23];
    const _div6 = _nodes[25];
    const _text2 = _document.createTextNode("");
    _slot3.replaceWith(_text2);
    _button12 = _button34;
    _button13 = _button35;
    _button14 = _button36;
    _button15 = _button37;
    _button16 = _button38;
    _button17 = _button39;
    _button18 = _button40;
    _button19 = _button41;
    _button20 = _button42;
    _button21 = _button43;
    _button22 = _button44;
    _text = _text2;
    _div3 = _div6;
  }
  let _value3 = () => {
    _write(data = buildData(1000));
    _write2(selected = null);
  };
  let _listener;
  if (_listener !== undefined) _button12.removeEventListener("click", _listener);
  _listener = undefined;
  if (typeof _value3 === "function") {
    _listener = _writes === null ? _value3 : _writes.listener(_value3);
    _button12.addEventListener("click", _listener);
  }
  let _value4 = () => {
    _write(data = buildData(10000));
    _write2(selected = null);
  };
  let _listener2;
  if (_listener2 !== undefined) _button13.removeEventListener("click", _listener2);
  _listener2 = undefined;
  if (typeof _value4 === "function") {
    _listener2 = _writes === null ? _value4 : _writes.listener(_value4);
    _button13.addEventListener("click", _listener2);
  }
  let _value5 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "concat", 0, void 0)(buildData(1000)));
  };
  let _listener3;
  if (_listener3 !== undefined) _button14.removeEventListener("click", _listener3);
  _listener3 = undefined;
  if (typeof _value5 === "function") {
    _listener3 = _writes === null ? _value5 : _writes.listener(_value5);
    _button14.addEventListener("click", _listener3);
  }
  let _value6 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], buildData(1000), "concat", 0, void 0)(_MD.trackRead(() => _dataVersion, data, _readKey)));
  };
  let _listener4;
  if (_listener4 !== undefined) _button15.removeEventListener("click", _listener4);
  _listener4 = undefined;
  if (typeof _value6 === "function") {
    _listener4 = _writes === null ? _value6 : _writes.listener(_value6);
    _button15.addEventListener("click", _listener4);
  }
  let _value7 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "slice", 0, void 0)(0, -1000));
  };
  let _listener5;
  if (_listener5 !== undefined) _button16.removeEventListener("click", _listener5);
  _listener5 = undefined;
  if (typeof _value7 === "function") {
    _listener5 = _writes === null ? _value7 : _writes.listener(_value7);
    _button16.addEventListener("click", _listener5);
  }
  let _value8 = () => {
    for (let i = 0; i < _MD.trackRead(() => _dataVersion, data, _readKey).length; i += 10) _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey)[i], "label", _mutated_data).value += ' !!!';
  };
  let _listener6;
  if (_listener6 !== undefined) _button17.removeEventListener("click", _listener6);
  _listener6 = undefined;
  if (typeof _value8 === "function") {
    _listener6 = _writes === null ? _value8 : _writes.listener(_value8);
    _button17.addEventListener("click", _listener6);
  }
  let _value9 = () => {
    if (_MD.trackRead(() => _dataVersion, data, _readKey).length > 998) {
      const t = _MD.trackRead(() => _dataVersion, data, _readKey)[1];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 1, _mutated_data).value = _MD.trackRead(() => _dataVersion, data, _readKey)[998];
      _MD.mutationTarget(_MD.trackRead(() => _dataVersion, data, _readKey), 998, _mutated_data).value = t;
    }
  };
  let _listener7;
  if (_listener7 !== undefined) _button18.removeEventListener("click", _listener7);
  _listener7 = undefined;
  if (typeof _value9 === "function") {
    _listener7 = _writes === null ? _value9 : _writes.listener(_value9);
    _button18.addEventListener("click", _listener7);
  }
  let _value10 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "reverse", 0, void 0)();
  };
  let _listener8;
  if (_listener8 !== undefined) _button19.removeEventListener("click", _listener8);
  _listener8 = undefined;
  if (typeof _value10 === "function") {
    _listener8 = _writes === null ? _value10 : _writes.listener(_value10);
    _button19.addEventListener("click", _listener8);
  }
  let _value11 = () => {
    _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "splice", 0, void 0)(500, 1);
  };
  let _listener9;
  if (_listener9 !== undefined) _button20.removeEventListener("click", _listener9);
  _listener9 = undefined;
  if (typeof _value11 === "function") {
    _listener9 = _writes === null ? _value11 : _writes.listener(_value11);
    _button20.addEventListener("click", _listener9);
  }
  let _value12 = () => {
    _write(data = _MD.observeMethod([() => data], [_mutated_data], _MD.trackRead(() => _dataVersion, data, _readKey), "filter", 1, void 0)((_item, index) => index % 100 !== 0));
  };
  let _listener10;
  if (_listener10 !== undefined) _button21.removeEventListener("click", _listener10);
  _listener10 = undefined;
  if (typeof _value12 === "function") {
    _listener10 = _writes === null ? _value12 : _writes.listener(_value12);
    _button21.addEventListener("click", _listener10);
  }
  let _value13 = () => {
    _write(data = []);
    _write2(selected = null);
  };
  let _listener11;
  if (_listener11 !== undefined) _button22.removeEventListener("click", _listener11);
  _listener11 = undefined;
  if (typeof _value13 === "function") {
    _listener11 = _writes === null ? _value13 : _writes.listener(_value13);
    _button22.addEventListener("click", _listener11);
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
  let _value14 = _MD.observeMethod([() => data], [_mutated_data], data, "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2), "select": select })));
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
      const _next4 = _MD.observeMethod([() => data], [_mutated_data], data, "map", 1, _rowList)((item) => (_MD.createComponentValue(Row, { "key": item.id, "item": item, "selected": _MD.trackEquals(selected, item.id, () => selected, () => _selectedVersion, _readKey2), "select": select })));
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
  return _div3;
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
