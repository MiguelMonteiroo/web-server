import { Socket } from 'dgram';
import * as net from 'net';

type TCPConn = {
    socket: net.Socket;
    err: null | Error;
    ended: boolean
    reader: null | {
        resolve: (value: Buffer) => void,
        reject: (reason: Error) => void,
    };
};

type TCPListener = {
    server: net.Server;
    err: null | Error;
    accepter: null | {
        resolve: (conn: TCPConn) => void,
        reject: (reason: Error) => void,
    };
};


type DynBuf = {
    data: Buffer,
    length: number
};

function bufPush(buf: DynBuf, data: Buffer): void {
    const newLen = buf.length + data.length;
    if (buf.data.length < newLen) {
        let cap = Math.max(buf.data.length, 32);

        while (cap < newLen) {
            cap *= 2;
        }
        const grown = Buffer.alloc(cap);
        buf.data.copy(grown, 0, 0)
        buf.data = grown;
    }
    data.copy(buf.data, buf.length, 0);
    buf.length = newLen;
}



function soInit(socket: net.Socket): TCPConn {
    const conn: TCPConn = {
        socket: socket, err: null, ended: false, reader: null,
    };
    socket.on('data', (data: Buffer) => {
        console.assert(conn.reader);
        conn.socket.pause();
        conn.reader!.resolve(data);
        conn.reader = null;

    });

    socket.on('end', () => {
        conn.ended = true;
        if (conn.reader) {
            conn.reader.resolve(Buffer.from(''));
            conn.reader = null;
        }
    });
    socket.on('error', (err: Error) => {
        conn.err = err;
        if (conn.reader) {
            conn.reader.reject(err);
            conn.reader = null;
        }
    })

    return conn;
}

function soRead(conn: TCPConn): Promise<Buffer> {
    console.assert(!conn.reader);
    return new Promise((resolve, reject) => {
        if (conn.err) {
            reject(conn.err);
            return;
        }
        if (conn.ended) {
            resolve(Buffer.from(''));
            return;
        }
        conn.reader = { resolve: resolve, reject: reject };
        conn.socket.resume();
    })
}

function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
    console.assert(data.length > 0);
    return new Promise((resolve, reject) => {
        if (conn.err) {
            reject(conn.err);
            return;
        }
        conn.socket.write(data, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}



function cutMessage(buf:DynBuf): null|Buffer{
    const idx = buf.data.subarray(0, buf.length).indexOf('\n');
    if(idx <0){
        return null;
    }
    const msg = Buffer.from(buf.data.subarray(0, idx + 1));
    bufPop(buf, idx + 1);
    return  msg
}

function bufPop(buf:DynBuf, len: number): void{
    buf.data.copyWithin(0, len, buf.length);
    buf.length -= len;
}

async function serveClient(conn: TCPConn): Promise<void> {
    const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };
    while (true) {
        const msg:null|Buffer = cutMessage(buf);
        if (!msg) {
            const data = await soRead(conn);
            bufPush(buf, data);
            
            if (data.length === 0) {
                console.log('end connection');
                return;
            }
            continue;
        }

        if(msg.equals(Buffer.from('quit\n'))){
            await soWrite(conn, Buffer.from('Bye.\n'));
            conn.socket.destroy();
            return;
        }else{
            const reply = Buffer.concat([Buffer.from('Echo: '), msg])
            await soWrite(conn, reply);
        }
    }
}


function soListen(host: string, port: number): TCPListener {
    let server = net.createServer({ pauseOnConnect: true });

    const listener: TCPListener = {
        server,
        err: null,
        accepter: null
    }

    server.on('connection', (socket: net.Socket) => {
        console.assert(listener.accepter);
        const conn = soInit(socket);
        listener.accepter!.resolve(conn)
        listener.accepter = null;
    })

    server.on('error', (err: Error) => {
        listener.err = err;
        if (listener.accepter) {
            listener.accepter.reject(err);
            listener.accepter = null;
        }
    })
    server.listen({ host, port })
    return listener

}

function soAccept(listener: TCPListener): Promise<TCPConn> {
    console.assert(!listener.accepter);
    return new Promise((resolve, reject) => {
        if (listener.err) {
            reject(listener.err);
            return;
        }
        listener.accepter = { resolve, reject };
    })
}

const listener = soListen('127.0.0.1', 1234);

while (true) {
    const conn = await soAccept(listener);
    serveClient(conn).catch(err => {
        console.error('client error:', err)
    });
}
