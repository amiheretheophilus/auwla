import { makePage, makeShape, type Project, type Shape } from './types';

function label(x: number, y: number, width: number, text: string, size = 16, stroke = '#645e75'): Shape {
  return makeShape('text', { x, y, width, height: size + 16 }, { text, title: text, weight: size, stroke });
}

function card(x: number, y: number, text: string, fill: string, stroke: string): Shape {
  return makeShape('rectangle', { x, y, width: 190, height: 110 }, { title: text, text, fill, stroke });
}

function horizontalArrow(x: number, y: number): Shape {
  return makeShape('arrow', { x, y, width: 45, height: 0 }, {
    points: [{ x: 0, y: 0 }, { x: 45, y: 0 }], stroke: '#9484c5',
  });
}

export function workflow(): Shape[] {
  return [
    label(124, 98, 590, 'PRODUCT WORKFLOW', 13, '#7254dc'),
    label(124, 127, 640, 'From idea to impact', 39, '#28223d'),
    label(124, 188, 636, 'A simple map for turning loose ideas into real work.', 15),
    card(124, 270, 'Discover', '#eee8ff', '#7e63e7'),
    card(369, 270, 'Explore', '#e2edff', '#7599e4'),
    card(614, 270, 'Deliver', '#ddf5ed', '#5cae96'),
    horizontalArrow(319, 325),
    horizontalArrow(564, 325),
    label(124, 391, 194, 'Gather context', 14),
    label(369, 391, 194, 'Test the risky bits', 14),
    label(614, 391, 194, 'Ship and learn', 14),
    makeShape('note', { x: 370, y: 455, width: 188, height: 101 }, {
      title: 'Feedback note', text: 'Keep the feedback\nloop small.', fill: '#fff0bf', stroke: '#aa7622',
    }),
  ];
}

export function brainstorm(): Shape[] {
  return [
    label(144, 128, 580, 'What could we try?', 38, '#28223d'),
    makeShape('note', { x: 144, y: 225, width: 190, height: 132 }, {
      title: 'Ideas', text: 'Ideas', fill: '#fff0bf', stroke: '#aa7622',
    }),
    makeShape('note', { x: 368, y: 225, width: 190, height: 132 }, {
      title: 'Questions', text: 'Questions', fill: '#eee8ff', stroke: '#6b4ee6',
    }),
    makeShape('note', { x: 592, y: 225, width: 190, height: 132 }, {
      title: 'Next steps', text: 'Next steps', fill: '#ddf5ed', stroke: '#18876d',
    }),
  ];
}

export function initialProject(): Project {
  const page = makePage('Product flow', workflow());
  return { version: 1, activeId: page.id, pages: [page, makePage('Brainstorm', brainstorm())] };
}
