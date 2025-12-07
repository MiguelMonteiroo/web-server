import * as net from 'net';


function newConn(socket: net.Socket): void{
    console.log('new connection', socket.remoteAddress, socket.remotePort)  
    socket.on('end', () => {
        console.log('EOF.')
    });
    socket.on('data', (data: Buffer) =>{
        console.log('data:', data)
        socket.write(data);
        
        if(data.includes('q')){
            console.log('closing');
            socket.end();
        }
    })

}

let server = net.createServer();
server.on('connection', newConn);
server.on('error', (err: Error) => {throw err;});
server.listen({host:'127.0.0.1', port: 1234});
