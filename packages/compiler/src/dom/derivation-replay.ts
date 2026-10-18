/** Lower authored stable-source replay facts into this backend's data ABI. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode} from '../ast';
import type {LocalDerivation} from '../components/props';
import {assignmentTarget} from './props';
import type {DomContext} from './context';
import {mdd} from './identifiers';

export function buildDerivationReplay(ctx:DomContext,derivation:LocalDerivation):t.Statement {
  const replay=derivation.replay;
  if(replay!==undefined) {
    if(!astFactory.isIdentifier(derivation.target))
      throw new Error('memo-dom: stable source replay requires an identifier target');
    const target=derivation.target;
    const rebind=(call:t.CallExpression):t.Expression=>replay.kind==='provider'
      ? astFactory.callExpression(mdd(ctx,'rebindResolvedValue'),
          [cloneNode(target),...call.arguments.map(argument=>cloneNode(argument))])
      : astFactory.callExpression(mdd(ctx,'rebindResolvedValueFromFactory'),
          [cloneNode(target),astFactory.arrowFunctionExpression([],cloneNode(call))]);
    if(replay.gate===undefined) return astFactory.expressionStatement(rebind(replay.call));
    // The gate's callback receives the committed values in place of the
    // sources the call reads; the rebind runs inside it.
    const gate=cloneNode(replay.gate,true);
    const callback=gate.arguments[1];
    if(!astFactory.isArrowFunctionExpression(callback)||!astFactory.isCallExpression(callback.body))
      throw new Error('memo-dom: gated source replay requires a call callback');
    callback.body=rebind(callback.body);
    return astFactory.expressionStatement(gate);
  }
  return astFactory.expressionStatement(astFactory.assignmentExpression('=',
    assignmentTarget(derivation.target),cloneNode(derivation.source)));
}
