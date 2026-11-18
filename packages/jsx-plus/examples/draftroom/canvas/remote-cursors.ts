import type { Camera } from '../model/types';
import type { Peer } from '../rooms/protocol';

const colors = ['#6849db', '#08766e', '#b13b57', '#245a98', '#985113'];

function color(id: string): string {
  return colors[Number.parseInt(id.slice(0, 6), 16) % colors.length] ?? colors[0]!;
}

/** Presence moves small DOM labels without scheduling a canvas paint or rebuilding the inspector. */
export function createRemoteCursors() {
  let layer: HTMLDivElement | undefined;
  const nodes = new Map<string, HTMLDivElement>();

  function attach(host: HTMLDivElement): () => void {
    layer = host;
    return () => {
      host.replaceChildren();
      nodes.clear();
      layer = undefined;
    };
  }

  function show(peers: Peer[], camera: Camera, page: string): void {
    if (layer === undefined) return;

    const visible = new Set<string>();
    for (const peer of peers) {
      if (peer.pageId !== page || peer.cursor === null) continue;

      visible.add(peer.id);
      let node = nodes.get(peer.id);
      if (node === undefined) {
        node = layer.ownerDocument.createElement('div');
        node.className = 'remote-cursor';
        node.style.setProperty('--peer-color', color(peer.id));
        nodes.set(peer.id, node);
        layer.append(node);
      }

      if (node.textContent !== peer.name) node.textContent = peer.name;
      const x = Math.round(camera.x + peer.cursor.x * camera.zoom);
      const y = Math.round(camera.y + peer.cursor.y * camera.zoom);
      const position = `translate(${x}px, ${y}px)`;
      if (node.style.transform !== position) node.style.transform = position;
    }

    for (const [id, node] of nodes) {
      if (!visible.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }
  }

  return { attach, show };
}
