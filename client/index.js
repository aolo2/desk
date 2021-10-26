let canvas = null;
let slider = null;
let color_picker = null;
let ctx = null;
let socket = null;
let my_id = null;
let users = {};

let pencil_color = '#000000';
let did_something = false;
let current_tool = 'pencil';
let drawing = false;
let my_last_p = {'x': 0, 'y': 0};
let my_last_p_nn = null;
let eraser_width = 100;
let pencil_width = 2;

const history_max = 50;
let canvas_history = [];

const MESSAGE_TYPE = {
    'DRAW': 0,
    'INIT': 1,
    'USER_CONNECT': 2,
    'USER_DISCONNECT': 3,
    'STROKE_END': 4,
    'USER_STYLE_CHANGE': 5,
};

function get_blob() {
    return new Promise(function(resolve, reject) {
        canvas.toBlob(function(blob) {
            resolve(blob)
        })
    })
}

async function save_canvas() {
    const blob = await get_blob();
    if (canvas_history.length === history_max) {
        canvas_history.shift();
    }
    canvas_history.push(blob);
}

async function up() {
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointerleave', up);

    drawing = false;
    my_last_p = null;
    did_something = true;

    const data = new ArrayBuffer(8);
    const view = new Int32Array(data);

    view[0] = 4;
    view[1] = my_id;

    socket.send(data);
}

function draw(last_p, x, y) {
    if (last_p !== null) {
        ctx.beginPath();
        ctx.moveTo(last_p.x, last_p.y);
        ctx.lineTo(x, y);
        ctx.stroke();
    }
}

function move(e) {
    const x = e.offsetX;
    const y = e.offsetY;

    if (drawing) {
        draw(my_last_p, x, y);

        const data = new ArrayBuffer(16); // message tag (4 bytes) + my_id (4 bytes) + x (4 bytes) + y (4 bytes)
        const view = new Int32Array(data);

        view[0] = 0; // tag = 0 means POINT_DRAW
        view[1] = my_id;
        view[2] = x;
        view[3] = y;

        socket.send(data);
    }

    my_last_p = {'x': x, 'y': y};
    my_last_p_nn = {'x': x, 'y': y};
}

let last_sent_color = null;
let last_sent_width = null;

function send_style_update_if_changed() {
    const current_color = (current_tool === 'pencil' ? style_to_int(pencil_color) : 0xFFFFFF);
    const current_width = (current_tool === 'pencil' ? pencil_width : eraser_width);

    if (current_color !== last_sent_color || current_width != last_sent_width) {
        const data = new ArrayBuffer(16) // message tag + my_id + color + width
        const view = new Int32Array(data);

        view[0] = 5;
        view[1] = my_id;
        view[2] = current_color;
        view[3] = current_width;

        socket.send(data);

        last_sent_color = current_color;
        last_send_width = current_width;
    }
}

function down(e) {
    drawing = true;
    
    save_canvas();
    send_style_update_if_changed();

    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', up);

    const x = e.offsetX;
    const y = e.offsetY;

    draw(my_last_p, x, y);

    const data = new ArrayBuffer(16); // message tag (4 bytes) + my_id (4 bytes) + x (4 bytes) + y (4 bytes)
    const view = new Int32Array(data);

    view[0] = 0; // tag = 0 means POINT_DRAW
    view[1] = my_id;
    view[2] = x;
    view[3] = y;

    socket.send(data);

    my_last_p = {'x': x, 'y': y};
    my_last_p_nn = {'x': x, 'y': y};
}

function change_tool_to(tool) {
    if (tool === 'pencil') {
        slider.setAttribute('min', 1.5);
        slider.setAttribute('max', 10);
        ctx.strokeStyle = 'black';
        ctx.lineWidth = pencil_width;
        slider.value = pencil_width;
    } else if (tool === 'eraser') {
        slider.setAttribute('min', 30);
        slider.setAttribute('max', 500);
        ctx.strokeStyle = 'white';
        slider.value = eraser_width;
        ctx.lineWidth = eraser_width;
    }
    current_tool = tool;
}

function change_stroke_width(width) {
    if (current_tool === 'pencil') {
        pencil_width = width;
    } else if (current_tool === 'eraser') {
        eraser_width = width;
    }
    ctx.lineWidth = width;
}

function change_color_local() {
    pencil_color = color_picker.value;
    ctx.strokeStyle = pencil_color;
    send_style_update_if_changed();
}

function main() {
    canvas = document.getElementById('cv');
    canvas.width = 1920;
    canvas.height = 1080 * 3;
    ctx = canvas.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);

    slider = document.getElementById('stroke-width');
    color_picker = document.getElementById('stroke-color');

    document.getElementById('change-to-pencil').addEventListener('click', () => { change_tool_to('pencil'); })
    document.getElementById('change-to-eraser').addEventListener('click', () => { change_tool_to('eraser'); })
    color_picker.addEventListener('change', change_color_local);
    slider.addEventListener('change', () => { change_stroke_width(slider.value); })

    change_tool_to('pencil');

    socket = new WebSocket('ws://localhost:8080');
    socket.addEventListener('open', on_connect);
    socket.addEventListener('message', on_message);

    window.addEventListener('keydown', async (e) => {
        if (e.code === 'KeyZ' && e.ctrlKey) {
            e.preventDefault();
            if (canvas_history.length > 0) {
                const blob = canvas_history.pop();
                const bitmap = await createImageBitmap(blob);
                ctx.clearRect(0, 0, 1920, 1080 * 3);
                ctx.drawImage(bitmap, 0, 0);
            }
            did_something = false;
            return false;
        }
    })

    canvas.ondragover = canvas.ondragenter = function(evt) {
        evt.preventDefault();
        return false;
    };

    canvas.ondrop = async function(evt) {
       evt.preventDefault();
       const file = evt.dataTransfer.files[0];
       const bitmap = await createImageBitmap(file);
       save_canvas();
       ctx.drawImage(bitmap, evt.offsetX - Math.round(bitmap.width / 2), evt.offsetY - Math.round(bitmap.height / 2));
       return false;
    };
}

function on_connect() {
    console.log('connect')
}

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

function draw_initial_strokes(data, base, starts, styles) {
    for (let i = 0; i < starts.length - 1; ++i) {
        const from = starts[i];
        const to = starts[i + 1];

        const x0 = data[base + from + 0];
        const y0 = data[base + from + 1];

        const color = styles[i * 2 + 0];
        const width = styles[i * 2 + 1];
        const color_string = int_to_style(color);
       
        ctx.strokeStyle = color_string;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);

        for (let j = from + 2; j < to; j += 2) {
            const x = data[base + j + 0];
            const y = data[base + j + 1];

            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

}

function handle_draw(view) {
    // draw
    const user_id = view[1];
    const x = view[2];
    const y = view[3];

    if (user_id in users) {
        const last_p = users[user_id].last_p;
        
        if (users[user_id].width !== users[user_id].last_drawn_width) {
            ctx.lineWidth = users[user_id].width;
        }

        if (users[user_id].color !== users[user_id].last_drawn_color) {
            ctx.strokeStyle = users[user_id].color;
        }

        draw(last_p, x, y);

        users[user_id].last_p = {'x': x, 'y': y};
        users[user_id].last_drawn_color = users[user_id].color;
        users[user_id].last_drawn_width = users[user_id].width;
    }
}

function handle_init(view) {
    // init
    my_id = view[1];
    const user_count = view[2];
    let i = 3;
    for (let j = 0; j < user_count; ++j) {
        const uid = view[i];
        users[uid] = { 'last_p': null };
        ++i;
    }

    const fs_from_length = view[i];
    const fs_from = [];
    const fs_styles = [];
    ++i;

    for (let j = 0; j < fs_from_length; ++j) {
        const from = view[i];
        ++i;
        fs_from.push(from);
    }

    for (let j = 0; j < (fs_from_length - 1) * 2; ++j) {
        const s = view[i];
        ++i;
        fs_styles.push(s);
    }

    draw_initial_strokes(view, i, fs_from, fs_styles);
}

function handle_user_connect(view) {
    const user_id = view[1];
    users[user_id] = { 'last_p': null };
}

function handle_user_disconnect(view) {
    const user_id = view[1];
    delete users[user_id];
}

function handle_user_stroke_end(view) {
    const user_id = view[1];
    users[user_id].last_p = null;
}

function handle_user_style_change(view) {
    const uid = view[1];
    const color = view[2];
    const width = view[3];

    users[uid].color = int_to_style(color);
    users[uid].width = width;
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

        case MESSAGE_TYPE.USER_STYLE_CHANGE: {
            handle_user_style_change(view);
            break;
        }
    }
}

document.addEventListener('DOMContentLoaded', main);

window.addEventListener('paste', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.clipboardData.files[0];
    const bitmap = await createImageBitmap(file);
    save_canvas();
    ctx.drawImage(bitmap, my_last_p_nn.x - Math.round(bitmap.width / 2), my_last_p_nn.y - Math.round(bitmap.height / 2));
});