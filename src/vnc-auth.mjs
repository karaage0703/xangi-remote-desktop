import { createCipheriv } from 'node:crypto';

// RFC 6143 VNC Authentication. Equal 3DES keys perform single DES without
// requiring OpenSSL's legacy provider. VNC reverses the bits of each key byte.
export function challengeResponse(password, challenge) {
  const key = Buffer.alloc(8);
  for (let i = 0; i < Math.min(password.length, 8); i++) {
    let value = password.charCodeAt(i), reversed = 0;
    for (let bit = 0; bit < 8; bit++) { reversed = (reversed << 1) | (value & 1); value >>= 1; }
    key[i] = reversed;
  }
  const cipher = createCipheriv('des-ede3', Buffer.concat([key, key, key]), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(challenge), cipher.final()]);
}

// Translate only the authentication handshake; after that preserve RFB bytes.
export function createAuthBridge({ password, toServer, toViewer, onReady }) {
  let server = Buffer.alloc(0), viewer = Buffer.alloc(0);
  let upstream = 'version', downstream = 'version', version = 8, count = 0, bridged = false;
  function take(side, n) {
    const data = side === 'server' ? server : viewer;
    if (data.length < n) return null;
    if (side === 'server') server = data.subarray(n); else viewer = data.subarray(n);
    return data.subarray(0, n);
  }
  function pump() {
    let data;
    while (!bridged) {
      if (upstream === 'version' && (data = take('server', 12))) {
        const match = /^RFB 003\.00([378])\n$/.exec(data.toString('ascii'));
        if (!match) throw Error('Unsupported VNC protocol');
        version = Number(match[1]); toServer(data); upstream = version === 3 ? 'type33' : 'count';
      } else if (upstream === 'type33' && (data = take('server', 4))) {
        if (data.readUInt32BE() !== 2) throw Error('VNC password authentication required');
        upstream = 'challenge';
      } else if (upstream === 'count' && (data = take('server', 1))) {
        count = data[0]; if (!count) throw Error('VNC refused authentication'); upstream = 'types';
      } else if (upstream === 'types' && (data = take('server', count))) {
        if (!data.includes(2)) throw Error('Unsupported VNC authentication');
        toServer(Buffer.from([2])); upstream = 'challenge';
      } else if (upstream === 'challenge' && (data = take('server', 16))) {
        toServer(challengeResponse(password, data)); upstream = 'result';
      } else if (upstream === 'result' && (data = take('server', 4))) {
        if (data.readUInt32BE() !== 0) throw Error('VNC authentication failed'); upstream = 'ready';
      } else if (downstream === 'version' && (data = take('viewer', 12))) {
        if (data.toString() !== 'RFB 003.008\n') throw Error('Viewer must use RFB 3.8');
        toViewer(Buffer.from([1, 1])); downstream = 'choice';
      } else if (downstream === 'choice' && (data = take('viewer', 1))) {
        if (data[0] !== 1) throw Error('Unexpected viewer authentication'); downstream = 'ready';
      } else break;
    }
    if (upstream === 'ready' && downstream === 'ready' && !bridged) {
      bridged = true; password = ''; toViewer(Buffer.alloc(4)); onReady();
      if (server.length) toViewer(server);
      if (viewer.length) toServer(viewer);
      server = viewer = Buffer.alloc(0);
    }
  }
  toViewer(Buffer.from('RFB 003.008\n'));
  return {
    fromServer(data) {
      if (bridged) return toViewer(data);
      if (server.length + data.length > 65536) throw Error('Handshake too large');
      server = Buffer.concat([server, data]); pump();
    },
    fromViewer(data) {
      if (bridged) return toServer(data);
      if (viewer.length + data.length > 65536) throw Error('Handshake too large');
      viewer = Buffer.concat([viewer, data]); pump();
    },
  };
}
