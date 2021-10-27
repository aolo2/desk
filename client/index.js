const DEFAULT_WIDTH = 5;
const DEFAULT_COLOR = '#000000';

let Me = null;
let Ctx = null;
let Socket = null;
let Users = {};

let Elements = {
    'canvas': null,
    'slider': null,
    'color_picker': null
};

let MESSAGE_TYPE = {
    'DRAW': 0,
    'INIT': 1,
    'USER_CONNECT': 2,
    'USER_DISCONNECT': 3,
    'STROKE_END': 4,
    'USER_STYLE_CHANGE': 5,
    'STROKE_START': 6,
};

function leftpad(n, str) {
    let result = '';
    for (let i = 0; i < n - str.length; ++i) {
        result += '0';
    }
    result += str;
    return result;
}

function style_to_int(color) {
    return parseInt(color.substring(1), 16);
}

function int_to_style(color) {
    const r = (color & 0xFF0000) >> 16;
    const g = (color & 0x00FF00) >> 8;
    const b = color & 0x0000FF;
    const color_string = '#' + leftpad(2, r.toString(16)) + leftpad(2, g.toString(16)) + leftpad(2, b.toString(16));
    return color_string;
} 

function draw_strokes(strokes) {
    for (const stroke of strokes) {
        Ctx.lineWidth = stroke.width;
        Ctx.strokeStyle = stroke.color;

        Ctx.beginPath();
        for (let i = 1; i < stroke.points.length; ++i) {
            const point = stroke.points[i];
            Ctx.lineTo(point.x, point.y);
        }
        Ctx.stroke();
    }
}

function draw_current_stroke(user_id) {
    const stroke = Users[user_id].current_stroke;
    if (stroke !== null) {
        const last = stroke.points.length - 1;
        Ctx.lineWidth = Users[user_id].width;
        Ctx.strokeStyle = Users[user_id].color;
        Ctx.beginPath();
        if (stroke.points.length > 1) {
            Ctx.moveTo(stroke.points[last - 1].x, stroke.points[last - 1].y);
            Ctx.lineTo(stroke.points[last].x, stroke.points[last].y);
        } else {
            Ctx.moveTo(stroke.points[last].x, stroke.points[last].y);
        }
        Ctx.stroke();
    }
}

////////////////////////////////////////
//////////////////// Event listeners
////////////////////////////////////////
function change_color(e) {
    const color = e.target.value;
    const color_packed = style_to_int(color);

    const data = new ArrayBuffer(16) // message tag + my_id + color + width
    const view = new Int32Array(data);

    Users[Me].color = color;

    view[0] = MESSAGE_TYPE.USER_STYLE_CHANGE;
    view[1] = Me;
    view[2] = color_packed;
    view[3] = Users[Me].width;

    Socket.send(data);
}

function change_slider(e) {
    const width = e.target.value;
    const color_packed = style_to_int(Users[Me].color);

    const data = new ArrayBuffer(16) // message tag + my_id + color + width
    const view = new Int32Array(data);

    Users[Me].width = width;

    view[0] = MESSAGE_TYPE.USER_STYLE_CHANGE;
    view[1] = Me;
    view[2] = color_packed;
    view[3] = Users[Me].width;

    Socket.send(data);
}

////////////////////////////////////////
//////////////////// Pointer listeners
////////////////////////////////////////
async function up(e) {
    if (Me === null) return;
    
    const x = e.offsetX;
    const y = e.offsetY;

    const data = new ArrayBuffer(16);
    const view = new Int32Array(data);

    view[0] = MESSAGE_TYPE.STROKE_END;
    view[1] = Me;
    view[2] = x;
    view[3] = y;

    Socket.send(data);
    Users[Me].current_stroke.points.push({'x': x, 'y': y});
    draw_current_stroke(Me);
    Users[Me].current_stroke = null;

    Elements.canvas.removeEventListener('pointerup', up);
    Elements.canvas.removeEventListener('pointerleave', up);
}

function move(e) {
    if (Me === null) return;

    if (Users[Me].current_stroke !== null) {
        const x = e.offsetX;
        const y = e.offsetY;

        const data = new ArrayBuffer(16); // message tag (4 bytes) + my id (4 bytes) + x (4 bytes) + y (4 bytes)
        const view = new Int32Array(data);

        view[0] = MESSAGE_TYPE.DRAW;
        view[1] = Me;
        view[2] = x;
        view[3] = y;

        Socket.send(data);
        Users[Me].current_stroke.points.push({'x': x, 'y': y});
        draw_current_stroke(Me);
    }
}

function down(e) {
    if (Me === null) return;

    const x = e.offsetX;
    const y = e.offsetY;

    const data = new ArrayBuffer(16); // message tag (4 bytes) + my id (4 bytes) + x (4 bytes) + y (4 bytes)
    const view = new Int32Array(data);

    view[0] = MESSAGE_TYPE.STROKE_START;
    view[1] = Me;
    view[2] = x;
    view[3] = y;

    Socket.send(data);

    Users[Me].current_stroke = {
        'color': Users[Me].color,
        'width': Users[Me].width,
        'points': [{'x': x, 'y': y}]
    };

    draw_current_stroke(Me);

    Elements.canvas.addEventListener('pointerup', up);
    Elements.canvas.addEventListener('pointerleave', up);
}


////////////////////////////////////////
//////////////////// Handlers
////////////////////////////////////////
function handle_draw(view) {
    const user_id = view[1];
    const x = view[2];
    const y = view[3];
    Users[user_id].current_stroke.points.push({'x': x, 'y': y});
    draw_current_stroke(user_id);
}

function handle_init(view) {
    Me = view[1];

    let at = 2;
    let user_count = view[at++];
    let user_ids_ordered = [];

    for (let i = 0; i < user_count; ++i) {
        const user_id = view[at++];
        const user_color = view[at++];
        const user_width = view[at++];
        const user_current_stroke_length = view[at++];

        let user_current_stroke = null;
        if (user_current_stroke_length > 0) {
            user_current_stroke = [];
            user_current_stroke.length = user_current_stroke_length;
        }

        user_ids_ordered.push(user_id);

        Users[user_id] = {
            'color': int_to_style(user_color),
            'width': user_width,
            'current_stroke': user_current_stroke
        };
    }

    for (let i = 0; i < user_count; ++i) {
        const user_id = user_ids_ordered[i];
        const user = Users[user_id];

        if (user.current_stroke == null) {
            continue;
        }

        for (let j = 0; j < user.current_stroke.length; ++j) {
            const x = view[at++];
            const y = view[at++];
            user.current_stroke[j] = {'x': x, 'y': y};
        }
    }

    console.log(Users);

    const finished_strokes_length = view[at++];
    const finished_strokes = [];
    for (let i = 0; i < finished_strokes_length; ++i) {
        const length = view[at++];
        const color = int_to_style(view[at++]);
        const width = view[at++];
        const points = [];

        points.length = length;

        finished_strokes.push({
            'color': color,
            'width': width,
            'points': points
        });
    }

    for (let i = 0; i < finished_strokes_length; ++i) {
        for (let j = 0; j < finished_strokes[i].points.length; ++j) {
            const x = view[at++];
            const y = view[at++];
            finished_strokes[i].points[j] = {'x': x, 'y': y};
        }
    }

    draw_strokes(finished_strokes);
}

function handle_user_connect(view) {
    const user_id = view[1];
    if (user_id !== Me) {
        Users[user_id] = { 
            'color': DEFAULT_COLOR, 
            'width': DEFAULT_WIDTH,
            'current_stroke': null, 
        };
    }

    console.log(Users);
}

function handle_user_disconnect(view) {
    const user_id = view[1];
    delete Users[user_id];
    console.log(Users)
}

function handle_user_stroke_end(view) {
    const user_id = view[1];
    draw_current_stroke(user_id);
    Users[user_id].current_stroke = null;
}

function handle_user_stroke_start(view) {
    const user_id = view[1];
    const x = view[2];
    const y = view[3];

    Users[user_id].current_stroke = {
        'color': Users[user_id].color,
        'width': Users[user_id].width,
        'points': [{'x': x, 'y': y}]
    };

    draw_current_stroke(user_id);
}

function handle_user_style_change(view) {
    const user_id = view[1];
    const color = view[2];
    const width = view[3];

    Users[user_id].color = int_to_style(color);
    Users[user_id].width = width;

    console.log(Users)
}

////////////////////////////////////////
//////////////////// Socket listeners
////////////////////////////////////////
function on_close(event) {
    // console.log('Lost connection to server');
    // const id = setInterval(() => {
    //     console.log('Reconnecting...')
    //     try {
    //         Socket = new WebSocket('ws://localhost:8080');
    //     } catch (e) {
    //         console.log('Fail');
    //         return;
    //     }

    //     console.log('Success!');
    //     clearInterval(id);
    // }, 1000);
}

async function on_message(event) {
    const buffer = await event.data.arrayBuffer();
    const view = new Int32Array(buffer);
    const type = view[0];

    switch (type) {
        case MESSAGE_TYPE.DRAW: {
            handle_draw(view);
            break;
        }

        case MESSAGE_TYPE.INIT: {
            handle_init(view);
            break;
        }

        case MESSAGE_TYPE.USER_CONNECT: {
            handle_user_connect(view);
            break;
        }

        case MESSAGE_TYPE.USER_DISCONNECT: {
            handle_user_disconnect(view);
            break;
        }

        case MESSAGE_TYPE.STROKE_END: {
            handle_user_stroke_end(view);
            break;
        }

        case MESSAGE_TYPE.STROKE_START: {
            handle_user_stroke_start(view);
            break;
        }

        case MESSAGE_TYPE.USER_STYLE_CHANGE: {
            handle_user_style_change(view);
            break;
        }

        default: {
            console.error('Unhandled message type', type);
        }
    }
}

document.addEventListener('DOMContentLoaded', function main() {
    Elements.canvas = document.getElementById('cv');
    Elements.canvas.width = 1920;
    Elements.canvas.height = 1080 * 3;
    
    Ctx = Elements.canvas.getContext('2d');

    Ctx.lineWidth = 2;
    Ctx.lineJoin = 'round';
    Ctx.lineCap = 'round';

    Elements.canvas.addEventListener('pointerdown', down);
    Elements.canvas.addEventListener('pointermove', move);

    Elements.slider = document.getElementById('stroke-width');
    Elements.color_picker = document.getElementById('stroke-color');

    // document.getElementById('change-to-pencil').addEventListener('click', () => { change_tool_to('pencil'); })
    // document.getElementById('change-to-eraser').addEventListener('click', () => { change_tool_to('eraser'); })

    Elements.color_picker.addEventListener('change', change_color);
    Elements.slider      .addEventListener('change', change_slider);

    // change_tool_to('pencil');

    const path = new URL(window.location.href).pathname;

    Socket = new WebSocket(`ws://localhost:8080${path}`);
    Socket.addEventListener('message', on_message);
    // Socket.addEventListener('close', on_close);
});