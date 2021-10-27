import { WebSocketServer } from 'ws';
import { Buffer } from 'buffer';
import { open } from 'lmdb-store';

import * as http from 'http';
import * as fs from 'fs';

const wss = new WebSocketServer({ port: 8080 });
const store = open({ path: 'db.lmdb', dupSort: true });
const users = {};

const DEFAULT_WIDTH = 5;
const DEFAULT_COLOR = 0x000000;
const MESSAGE_TYPE = {
    'DRAW': 0,
    'INIT': 1,
    'USER_CONNECT': 2,
    'USER_DISCONNECT': 3,
    'STROKE_END': 4,
    'USER_STYLE_CHANGE': 5,
    'STROKE_START': 6,
};

function random_id() {
    return Math.floor(Math.random() * 4294967295);
}

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

function user_create(id, ws) {
    const user = { 
        'current_stroke': null, 
        'color': DEFAULT_COLOR, 
        'width': DEFAULT_WIDTH,
        'socket': ws,
    };

    return user;
}

function handle_draw(user_id, desk_id, message) {
    const x = message.readUInt32LE(2 * 4);
    const y = message.readUInt32LE(3 * 4);
    users[desk_id][user_id].current_stroke.push({'x': x, 'y': y});    
}

function handle_stroke_start(user_id, desk_id, message) {
    const x = message.readUInt32LE(2 * 4);
    const y = message.readUInt32LE(3 * 4);
    users[desk_id][user_id].current_stroke = [{'x': x, 'y': y}];
}

async function handle_stroke_end(user_id, desk_id, message) {
    const key_desk = 'desk:' + desk_id + ':strokes';

    const x = message.readUInt32LE(2 * 4);
    const y = message.readUInt32LE(3 * 4);
    const user = users[desk_id][user_id];

    user.current_stroke.push({'x': x, 'y': y});

    const finished_stroke = {
        'width': user.width,
        'color': user.color,
        'points': user.current_stroke,
    };

    console.log(finished_stroke.points.length)

    await store.put(key_desk, finished_stroke);

    let i = 0;
    for (const s of store.getValues(key_desk)) {
        ++i;
        // console.log(s.points.length, s.color, s.width);
    }
    console.log('now', i, '=', JSON.stringify(finished_stroke).length / 1024)

    user.current_stroke = null;
}

function handle_style_change(user_id, desk_id, message) {
    const color = message.readUInt32LE(2 * 4);
    const width = message.readUInt32LE(3 * 4);
    const user = users[desk_id][user_id];

    user.color = color;
    user.width = width;
}

function send_initital_info_to_connected_user(ws, user_id, desk_id) {
    const key_desk = 'desk:' + desk_id + ':strokes';

    const finished_strokes = [];

    let total_current_stroke_points = 0;
    let total_finished_strokes_points = 0;

    for (const user_id in users[desk_id]) {
        const user = users[desk_id][user_id];
        if (user.current_stroke !== null) {
            total_current_stroke_points += user.current_stroke.length;
        }
    }

    for (const stroke of store.getValues(key_desk)) {
        finished_strokes.push(stroke);
        total_finished_strokes_points += stroke.points.length;
    }

    let length = 0;

    length += 12; // type + my id + user count
    length += Object.keys(users[desk_id]).length * 16; // all user ids, colors, widths, current_stroke lengths
    length += total_current_stroke_points * 8; // all current_stokes packed
    length += 4; // finished_strokes length
    length += finished_strokes.length * 12; // all finished_strokes lengths, colors, widths
    length += total_finished_strokes_points * 8; // all finished_stokes packed

    const buffer = new ArrayBuffer(length);
    const view = new Int32Array(buffer);

    let at = 0;

    view[at++] = MESSAGE_TYPE.INIT;
    view[at++] = user_id;
    view[at++] = Object.keys(users[desk_id]).length;

    for (const user_id in users[desk_id]) {
        view[at++] = user_id;
        view[at++] = users[desk_id][user_id].color;
        view[at++] = users[desk_id][user_id].width;

        if (users[desk_id][user_id].current_stroke !== null) {
            view[at++] = users[desk_id][user_id].current_stroke.length;
        } else {
            view[at++] = 0;
        }
    }

    for (const user_id in users[desk_id]) {
        if (users[desk_id][user_id].current_stroke !== null) {
            for (let j = 0; j < users[desk_id][user_id].current_stroke.length; ++j) {
                const point = users[desk_id][user_id].current_stroke[j];
                view[at++] = point.x;
                view[at++] = point.y;
            }
        }
    }

    view[at++] = finished_strokes.length;

    for (let i = 0; i < finished_strokes.length; ++i) {
        view[at++] = finished_strokes[i].points.length;
        view[at++] = finished_strokes[i].color;
        view[at++] = finished_strokes[i].width;
    }

    for (let i = 0; i < finished_strokes.length; ++i) {
        const points = finished_strokes[i].points;
        for (let j = 0; j < points.length; ++j) {
            view[at++] = points[j].x;
            view[at++] = points[j].y;
        }
    }

    ws.send(buffer);
}

wss.on('connection', async (ws, req) => {
    let user_id = random_id();
    let desk_id = parseInt(req.url.replace('/desk/', ''));

    if (!(desk_id in users)) {
        users[desk_id] = {};
    }

    while (user_id in users[desk_id]) {
        user_id = random_id();
    }

    users[desk_id][user_id] = user_create(user_id, ws);

    send_initital_info_to_connected_user(ws, user_id, desk_id);

    for (const uid in users[desk_id]) {
        if (user_id !== parseInt(uid)) {
            send_user_connected(users[desk_id][uid].socket, user_id);
        }
    }   

    ws.on('message', async (message) => {
        const type = message.readUInt32LE(0);

        switch (type) {
            case MESSAGE_TYPE.DRAW: {
                handle_draw(user_id, desk_id, message);
                break;
            }

            case MESSAGE_TYPE.STROKE_START: {
                handle_stroke_start(user_id, desk_id, message);
                break;
            }

            case MESSAGE_TYPE.STROKE_END: {
                await handle_stroke_end(user_id, desk_id, message);
                break;
            }

            case MESSAGE_TYPE.USER_STYLE_CHANGE: {
                handle_style_change(user_id, desk_id, message);
                break;
            }
        }

        for (const uid in users[desk_id]) {
            if (user_id !== parseInt(uid)) {
                users[desk_id][uid].socket.send(message);
            }
        }
    });

    ws.on('close', () => {
        delete users[desk_id][user_id];
        for (const uid in users[desk_id]) {
            send_user_disconnected(users[desk_id][uid].socket, parseInt(user_id));
        }
    });
});