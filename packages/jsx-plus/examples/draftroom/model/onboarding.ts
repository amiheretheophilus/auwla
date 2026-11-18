import { prepareShapes } from './edits';
import { makeShape, type Shape } from './types';

function frame(title: string, x: number): Shape {
  return makeShape('frame', { x, y: 60, width: 340, height: 390 }, {
    title,
    fill: '#faf8fe',
    stroke: '#a790e0',
  });
}

function card(text: string, x: number, y: number, fill = '#eee8ff'): Shape {
  return makeShape('rectangle', { x, y, width: 250, height: 72 }, {
    title: text,
    text,
    fill,
    stroke: '#7158b5',
  });
}

function link(from: Shape, to: Shape): Shape {
  return makeShape('arrow', { x: from.x, y: from.y, width: 0, height: 1 }, {
    title: `${from.title} → ${to.title}`,
    stroke: '#6b4ee6',
    fromId: from.id,
    toId: to.id,
    points: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  });
}

export function onboarding(): Shape[] {
  const email = card('Send welcome email', 65, 122);
  const access = card('Request tool access', 65, 222);
  const meeting = card('Meet the team', 65, 322);

  const checklist = card('Send a starter checklist', 435, 122, '#ddf5ed');
  const ready = card('Confirm access before day one', 435, 222, '#ddf5ed');
  const buddy = card('Assign an onboarding buddy', 435, 322, '#ddf5ed');

  const question = makeShape('note', { x: 805, y: 122, width: 250, height: 97 }, {
    title: 'Access owner', text: 'Who owns the tool access checklist?', fill: '#fff0bf', stroke: '#aa7622',
  });
  const metric = makeShape('note', { x: 805, y: 249, width: 250, height: 97 }, {
    title: 'What success looks like', text: 'Can a new hire sign in and find their buddy on day one?',
    fill: '#fff0bf', stroke: '#aa7622',
  });

  return prepareShapes([
    frame('Current flow', 20), frame('Proposed flow', 390), frame('Open questions', 760),
    email, access, meeting, checklist, ready, buddy, question, metric,
    link(email, access), link(access, meeting), link(checklist, ready), link(ready, buddy),
  ]);
}
