import { WebSocketServer } from 'ws';
import { Buffer } from 'buffer';

import * as http from 'http';
import * as fs from 'fs';

const wss = new WebSocketServer({ port: 8080 });
const users = {};
const finished_strokes = [];
const fs_from = [];
const fs_styles = [];
let UID = 0;

function extension_to_mime(filename) {
    const parts = filename.split('.');
    const ext = parts[parts.length - 1];
    if (ext === 'html') return 'text/html';
    if (ext === 'css') return 'text/css';
    if (ext === 'js') return 'text/javascript';
    return 'text/plain';
}

const students = [{'name': 'Миша Рязанский 7кл', 'id': 1}, {'name': 'Маша Олоховникова 8кл', 'id': 2}, {'name': 'Мира Дибель 7кл', 'id': 3}];
const desks = [{'name': 'Доска 1', 'id': 1}, {'name': 'Доска с дробями', 'id': 2}, {'name': 'Вава вова', 'id': 3}];

function serve_student_select(res) {
    const content = 
        '<div class="content">'
        + '<h1>Ученики</h1>'
        + '<div class="students">'
        + students.map(s => `<div class="one-student"><a href="student/${s.id}">${s.name}</a></div>`).join('\n');
        + '</div>'
        + '</div>';

    const page = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <link rel="stylesheet" href="/default.css">
        <title>Desk</title>
    </head>
    <body>
        ${content}
    </body>
    </html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page, 'utf-8');
}
 
function serve_desk_select(res, student_id) {
    const content = 
        '<div class="content">'
        + '<h1>Доски</h1>'
        + '<div class="students">'
        + desks.map(d => `<div class="one-student"><a href="/desk/${d.id}">${d.name}</a></div>`).join('\n');
        + '</div>'
        + '</div>';

    const page = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <link rel="stylesheet" href="/default.css">
        <title>Desk</title>
    </head>
    <body>
        ${content}
    </body>
    </html>
    `;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page, 'utf-8');
}

function serve_desk(res, desk_id) {
    fs.readFile(`../client/desk.html`, (err, content) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content, 'utf-8');
    });
}

function serve_404(res) {
    fs.readFile(`../client/404.html`, (err, content) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content, 'utf-8');
    });   
}

function serve_static_file(res, filepath) {
    const filename = filepath.substring(1);
    const mimetype = extension_to_mime(filename);
    fs.readFile(`../client/${filename}`, (err, content) => {
        res.writeHead(200, { 'Content-Type': mimetype });
        res.end(content, 'utf-8');
    });
}

function dispatch(res, path) {
    const parts = path.split('/').filter(p => p.length > 0);

    if (path === '/') {
        serve_student_select(res);
    } else if (parts[0] === 'student') {
        const student_id = parseInt(parts[1]);
        serve_desk_select(res, student_id);
    } else if (parts[0] === 'desk') {
        const desk_id = parseInt(parts[1]);
        serve_desk(res, desk_id);
    } else {
        serve_static_file(res, path);
    }
}

const server = http.createServer((req, res) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        dispatch(res, url.pathname);
    } catch (e) {
        console.error(e);
        serve_404(res);
    }

    // if (req.url === '/' || req.url === '/index.js' || req.url === '/default.css') {
    //     const filename = (req.url === '/' ? 'index.html' : req.url.substring(1));
    //     const mimetype = extension_to_mime(filename);
    //     fs.readFile(`../client/${filename}`, (err, content) => {
    //         res.writeHead(200, { 'Content-Type': mimetype });
    //         res.end(content, 'utf-8');
    //     });
    // } else {
    //     res.writeHead(404);
    //     res.end();
    // }
});

server.listen(3003);

console.log('listening on 3003');

async function send_initial_data(ws, id) {
    let length = 0;
    
    length += 4; // type = 1
    length += 4; // my_id
    length += 4; // user count
    length += Object.keys(users).length * 4; // all user ids
    length += 4; // fs_from.length
    length += (fs_from.length + 1) * 4; // fs_from (+ terminator)
    length += fs_styles.length * 4; // fs_styles
    length += finished_strokes.length * 4; // finished_strokes

    const buffer = new ArrayBuffer(length);
    const view = new Int32Array(buffer);

    view[0] = 1;
    view[1] = id;
    view[2] = Object.keys(users).length;
    
    let i = 3;
    for (const uid in users) {
        view[i] = parseInt(uid);
        ++i;
    }

    view[i] = fs_from.length + 1;
    ++i;

    for (let j = 0; j < fs_from.length; ++j) {
        view[i] = fs_from[j];
        ++i;
    }

    view[i] = finished_strokes.length;
    ++i;

    for (let j = 0; j < fs_styles.length; ++j) {
        view[i] = fs_styles[j];
        ++i;
    }

    for (let j = 0; j < finished_strokes.length; ++j) {
        view[i] = finished_strokes[j];
        ++i;
    }

    ws.send(buffer);
}

function send_user_connected(ws, id) {
    const buffer = new ArrayBuffer(8);
    const view = new Int32Array(buffer);

    view[0] = 2;
    view[1] = id;

    ws.send(buffer);
}

function send_user_disconnected(ws, id) {
    const buffer = new ArrayBuffer(8);
    const view = new Int32Array(buffer);

    view[0] = 3;
    view[1] = id;

    ws.send(buffer);
}

async function async_compact_stroke(uid) {
    fs_from.push(finished_strokes.length);
    fs_styles.push(users[uid].color);
    fs_styles.push(users[uid].width);
    finished_strokes.push(...users[uid].strokes);
    users[uid].strokes.length = 0;
}

wss.on('connection', (ws) => {
    let id = UID++;
    users[id] = {'socket': ws, 'strokes': [], 'finished_strokes': [], 'fs_from': [], 'color': null, 'width': null};
    
    send_initial_data(ws, id);

    for (const uid in users) {
        if (id !== uid) {
            send_user_connected(users[uid].socket, parseInt(id));
        }
    }   

    ws.on('message', (message, isBinary) => {
        const type = message.readUInt32LE(0);
        if (type === 0) {
            const x = message.readUInt32LE(2 * 4);
            const y = message.readUInt32LE(3 * 4);
            users[id].strokes.push(x);
            users[id].strokes.push(y);
        } else if (type === 4) {
            async_compact_stroke(id);
        } else if (type === 5) {
            const color = message.readUInt32LE(2 * 4);
            const width = message.readUInt32LE(3 * 4);
            users[id].color = color;
            users[id].width = width;
        }

        for (const uid in users) {
            if (id !== parseInt(uid)) {
                users[uid].socket.send(message);
            }
        }
    });

    ws.on('close', () => {
        delete users[id];
        for (const uid in users) {
            send_user_disconnected(users[uid].socket, parseInt(id));
        }
    });
});