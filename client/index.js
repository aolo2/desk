const DEFAULT_WIDTH = 5;
const DEFAULT_COLOR = '#000000';

let Me = null;
let Ctx = null;
let Ctx3 = null;

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
    'UNDO': 7,
};

function random_id() {
    return Math.floor(Math.random() * 4294967295);
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

function stroke_stats(points, width) {
    let length = 0;
    let xmin = points[0].x, ymin = points[0].y;
    let xmax = xmin, ymax = ymin;

    for (let i = 0; i < points.length; ++i) {
        const point = points[i];
        if (point.x < xmin) xmin = point.x;
        if (point.y < ymin) ymin = point.y;
        if (point.x > xmax) xmax = point.x;
        if (point.y > ymax) ymax = point.y;

        if (i > 0) {
            const last = points[i - 1];
            const dx = point.x - last.x;
            const dy = point.y - last.y;
            length += Math.sqrt(dx * dx + dy * dy);
        }
    }

    xmin -= width;
    ymin -= width;
    xmax += width * 2;
    ymax += width * 2;

    const bbox = {
        'xmin': Math.floor(xmin),
        'ymin': Math.floor(ymin),
        'xmax': Math.ceil(xmax),
        'ymax': Math.ceil(ymax)
    };

    return {
        'bbox': bbox,
        'length': length,
    };
}

function draw_stroke(ctx, stroke) {
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = stroke.color;

    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; ++i) {
        const point = stroke.points[i];
        ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
}

function full_redraw() {
    console.time('Full redraw');

    Ctx.clearRect(0, 0, Elements.canvas.width, Elements.canvas.height);

    for (const user_id in Users) {
        const user = Users[user_id];
        for (const stroke of user.finished_strokes) {
            draw_stroke(Ctx, stroke);
        }
    }

    console.timeEnd('Full redraw');
}

function segment_intersects_horizontal(p0, p1, y, x0, x1) {
    if (Math.abs(p1.y - p0.y) < 0.001) return false;
    const t = (y - p0.y) / (p1.y - p0.y);
    const x = p0.x + (p1.x - p0.x) * t;
    return (x0 <= x && x <= x1);
}

function segment_intersects_vertical(p0, p1, x, y0, y1) {
    if (Math.abs(p1.x - p0.x) < 0.001) return false;
    const t = (x - p0.x) / (p1.x - p0.x);
    const y = p0.y + (p1.y - p0.y) * t;
    return (y0 <= y && y <= y1);
}

function rectangles_intersect(a, b) {
    const result = (
        a.xmin <= b.xmax
        && a.xmax >= b.xmin
        && a.ymin <= b.ymax 
        && a.ymax >= b.ymin
    );

    return result;
}

function stroke_intersects_region(stroke, bbox) {
    const stats = stroke_stats(stroke.points, stroke.width);

    if (!rectangles_intersect(stats.bbox, bbox)) return false;
    return true;

    // for (let i = 1; i < stroke.points.length; ++i) {
    //     const p0 = stroke.points[i - 1];
    //     const p1 = stroke.points[i];

    //     if ((bbox.xmin <= p0.x && p0.x <= bbox.xmax) && (bbox.ymin <= p0.y && p0.y <= bbox.ymax)
    //         &&
    //         (bbox.xmin <= p1.x && p1.x <= bbox.xmax) && (bbox.ymin <= p1.y && p1.y <= bbox.ymax)) 
    //     {
    //         return true;
    //     }

    //     if (segment_intersects_horizontal(p0, p1, bbox.ymin, bbox.xmin, bbox.xmax)) return true;
    //     if (segment_intersects_vertical  (p0, p1, bbox.xmax, bbox.ymin, bbox.ymax)) return true;
    //     if (segment_intersects_horizontal(p0, p1, bbox.ymax, bbox.xmin, bbox.xmax)) return true;
    //     if (segment_intersects_vertical  (p0, p1, bbox.xmin, bbox.ymin, bbox.ymax)) return true;
    // }

    return false;
}

function redraw_region(bbox) {
    console.time('redraw region');

    Ctx.save();
    Ctx.clearRect(bbox.xmin, bbox.ymin, bbox.xmax - bbox.xmin, bbox.ymax - bbox.ymin);
    
    Ctx.beginPath();
        Ctx.rect(bbox.xmin, bbox.ymin, bbox.xmax - bbox.xmin, bbox.ymax - bbox.ymin);
    Ctx.clip();

    for (const user_id in Users) {
        const user = Users[user_id];
        for (const stroke of user.finished_strokes) {
            if (stroke_intersects_region(stroke, bbox)) {
                draw_stroke(Ctx, stroke);
            }
        }
    }

    Ctx.restore();

    console.timeEnd('redraw region');
}

function redraw_current() {
    Ctx2.clearRect(0, 0, Elements.canvas.width, Elements.canvas.height); // TODO: only bboxes
    
    for (const user_id in Users) {
        const user = Users[user_id];
        if (user.current_stroke !== null) {
            Ctx2.lineWidth = user.width;
            Ctx2.strokeStyle = user.color;

            Ctx2.beginPath();
            Ctx2.moveTo(user.current_stroke[0].x, user.current_stroke[0].y);
            for (let i = 1; i < user.current_stroke.length; ++i) {
                const point = user.current_stroke[i];
                Ctx2.lineTo(point.x, point.y);
            }
            Ctx2.stroke();
        }
    }
}

function draw_current_stroke(user_id) {
    const stroke = Users[user_id].current_stroke;

    if (stroke !== null) {
        const last = stroke.length - 1;
        Ctx2.lineWidth = Users[user_id].width;
        Ctx2.strokeStyle = Users[user_id].color;
        Ctx2.beginPath();
        if (stroke.length > 1) {
            Ctx2.moveTo(stroke[last - 1].x, stroke[last - 1].y);
            Ctx2.lineTo(stroke[last].x, stroke[last].y);
        } else {
            Ctx2.moveTo(stroke[last].x, stroke[last].y);
        }
        Ctx2.stroke();
    }
}

function rdp_find_max(points, start, end) {
    const EPS = 0.5;

    let result = -1;
    let max_dist = 0;

    const a = points[start];
    const b = points[end];

    const dx = b.x - a.x;
    const dy = b.y - a.y;

    const dist_ab = Math.sqrt(dx * dx + dy * dy);
    const sin_theta = dy / dist_ab;
    const cos_theta = dx / dist_ab;

    for (let i = start; i < end; ++i) {
        const p = points[i];
        
        const ox = p.x - a.x;
        const oy = p.y - a.y;

        const rx = cos_theta * ox + sin_theta * oy;
        const ry = -sin_theta * ox + cos_theta * oy;

        const x = rx + a.x;
        const y = ry + a.y;

        const dist = Math.abs(y - a.y);

        if (dist > EPS && dist > max_dist) {
            result = i;
            max_dist = dist;
        }
    }

    return result;
}

function process_rdp_r(points, start, end) {
    let result = [];
    
    const max = rdp_find_max(points, start, end);

    if (max !== -1) {
        const before = process_rdp_r(points, start, max);
        const after = process_rdp_r(points, max, end);
        result = [...before, points[max], ...after];
    }

    return result;
}

function process_rdp(points) {
    const result = process_rdp_r(points, 0, points.length - 1);
    result.unshift(points[0]);
    result.push(points[points.length - 1]);
    return result;
}

function process_ewmv(points) {
    const result = [];
    const alpha = 0.4;

    result.push(points[0]);

    for (let i = 1; i < points.length; ++i) {
        const p = points[i];
        const x = alpha * p.x + (1 - alpha) * result[result.length - 1].x;
        const y = alpha * p.y + (1 - alpha) * result[result.length - 1].y;
        result.push({'x': x, 'y': y});
    }

    return result;
}

function process_stroke(points) {
    const result0 = process_ewmv(points);
    const result1 = process_rdp(result0);
    return result1;
}

function bake_current_stroke(user_id, points) {
    const processed_stroke = process_stroke(points);

    Ctx.lineWidth = Users[user_id].width;
    Ctx.strokeStyle = Users[user_id].color;

    Ctx.beginPath();
        Ctx.moveTo(processed_stroke[0].x, processed_stroke[0].y);
        for (let i = 1; i < processed_stroke.length; ++i) {
            const p = processed_stroke[i];
            Ctx.lineTo(p.x, p.y);
        }
    Ctx.stroke();

    Ctx3.lineWidth = Users[user_id].width;
    Ctx3.strokeStyle = 'blue';

    Ctx3.beginPath();
        for (let i = 0; i < processed_stroke.length; ++i) {
            const p = processed_stroke[i];
            Ctx3.moveTo(p.x, p.y);
            Ctx3.lineTo(p.x, p.y);
        }
    Ctx3.stroke();

    return processed_stroke;
}

////////////////////////////////////////
//////////////////// Event listeners
////////////////////////////////////////
function update_stroke_preview(e) {
    const width = Elements.slider.value;
    const color = Elements.color_picker.value;

    const w = Math.round(width / 2) + 'px';

    Elements.preview.style.transform = `translate(${w}, -${w})`;
    Elements.preview.style.width = width + 'px';
    Elements.preview.style.height = width + 'px';
    Elements.preview.style.background = color;

    Elements.cursor.style.width = width + 'px';
    Elements.cursor.style.height = width + 'px';
}

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

    (async () => { Socket.send(data); })();
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

    (async () => { Socket.send(data); })();
}

////////////////////////////////////////
//////////////////// Pointer listeners
////////////////////////////////////////
async function up(e) {
    if (Me === null) return;
    
    const x = e.offsetX;
    const y = e.offsetY;

    const data = new ArrayBuffer(20);
    const view = new Int32Array(data);
    const stroke_id = random_id();

    view[0] = MESSAGE_TYPE.STROKE_END;
    view[1] = Me;
    view[2] = x;
    view[3] = y;
    view[4] = stroke_id;

    (async () => { Socket.send(data); })();

    Users[Me].current_stroke.push({'x': x, 'y': y});
    
    const simplified_points = bake_current_stroke(Me, Users[Me].current_stroke);

    Users[Me].finished_strokes.push({
        'id': stroke_id,
        'color': Users[Me].color,
        'width': Users[Me].width,
        'points': simplified_points
    });

    Users[Me].current_stroke = null;

    Elements.canvas.removeEventListener('pointerup', up);
    Elements.canvas.removeEventListener('pointerleave', up);

    redraw_current();
}

function move(e) {
    if (Me === null) return;
    
    const x = e.offsetX;
    const y = e.offsetY;
    const width = Users[Me].width;

    Elements.cursor.style.transform = `translate(${Math.round(x - width / 2)}px, ${Math.round(y - width / 2)}px)`;

    if (Users[Me].current_stroke !== null) {
        const data = new ArrayBuffer(16); // message tag (4 bytes) + my id (4 bytes) + x (4 bytes) + y (4 bytes)
        const view = new Int32Array(data);

        view[0] = MESSAGE_TYPE.DRAW;
        view[1] = Me;
        view[2] = x;
        view[3] = y;

        (async () => { Socket.send(data); })();

        Users[Me].current_stroke.push({'x': x, 'y': y});
        draw_current_stroke(Me);
    }
}

function undo() {
    const data = new ArrayBuffer(12); // message tag (4) + my id (4) + stroke id (4)
    const view = new Int32Array(data);

    const deleted_stroke = Users[Me].finished_strokes.pop();

    if (deleted_stroke) {
        view[0] = MESSAGE_TYPE.UNDO;
        view[1] = Me;
        view[2] = deleted_stroke.id;

        (async () => { Socket.send(data); })();

        const stats = stroke_stats(deleted_stroke.points, deleted_stroke.width);
        redraw_region(stats.bbox);
    }
}

function down(e) {
    if (Me === null) return;

    // TMP
    if (e.button == 1) undo(e);

    if (e.button !== 0) return;

    const x = e.offsetX;
    const y = e.offsetY;

    const data = new ArrayBuffer(16); // message tag (4 bytes) + my id (4 bytes) + x (4 bytes) + y (4 bytes)
    const view = new Int32Array(data);

    view[0] = MESSAGE_TYPE.STROKE_START;
    view[1] = Me;
    view[2] = x;
    view[3] = y;

    (async () => { Socket.send(data); })();

    Users[Me].current_stroke = [{'x': x, 'y': y}];

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
    Users[user_id].current_stroke.push({'x': x, 'y': y});
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
            'current_stroke': user_current_stroke,
            'finished_strokes': [],
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

    const finished_strokes_length = view[at++];
    const finished_strokes = [];

    for (let i = 0; i < finished_strokes_length; ++i) {
        const id = view[at++];
        const length = view[at++];
        const color = int_to_style(view[at++]);
        const width = view[at++];
        const user_id = view[at++];
        const points = [];

        points.length = length;

        finished_strokes.push({
            'id': id,
            'color': color,
            'width': width,
            'points': points,
            'user_id': user_id
        });
    }

    for (let i = 0; i < finished_strokes_length; ++i) {
        for (let j = 0; j < finished_strokes[i].points.length; ++j) {
            const x = view[at++];
            const y = view[at++];
            finished_strokes[i].points[j] = {'x': x, 'y': y};
        }

        const user_id = finished_strokes[i].user_id;

        if (!(user_id in Users)) {
            Users[user_id] = {
                'color': DEFAULT_COLOR, 
                'width': DEFAULT_WIDTH,
                'current_stroke': null,
                'finished_strokes': []
            };
        }

        Users[user_id].finished_strokes.push(finished_strokes[i]);
    }

    full_redraw();
}

function handle_user_connect(view) {
    const user_id = view[1];
    if (user_id !== Me) {
        Users[user_id] = { 
            'color': DEFAULT_COLOR, 
            'width': DEFAULT_WIDTH,
            'current_stroke': null,
            'finished_strokes': [],
        };
    }
}

function handle_user_disconnect(view) {
    const user_id = view[1];
    delete Users[user_id];
}

function handle_user_stroke_end(view) {
    const user_id = view[1];
    const x = view[2];
    const y = view[3];
    const stroke_id = view[4];
    
    Users[user_id].current_stroke.push({'x': x, 'y': y});
    
    const simplified_points = bake_current_stroke(user_id, Users[user_id].current_stroke);

    Users[user_id].finished_strokes.push({
        'id': stroke_id,
        'width': Users[user_id].width,
        'color': Users[user_id].color,
        'points': simplified_points,
    });

    Users[user_id].current_stroke = null;

    redraw_current();
}

function handle_user_stroke_start(view) {
    const user_id = view[1];
    const x = view[2];
    const y = view[3];

    Users[user_id].current_stroke = [{'x': x, 'y': y}];

    draw_current_stroke(user_id);
}

function handle_user_style_change(view) {
    const user_id = view[1];
    const color = view[2];
    const width = view[3];

    Users[user_id].color = int_to_style(color);
    Users[user_id].width = width;

    // console.log(Users)
}

function handle_user_delete_last_stroke(view) {
    const user_id = view[1];
    Users[user_id].finished_strokes.pop();
    full_redraw();
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

        case MESSAGE_TYPE.UNDO: {
            handle_user_delete_last_stroke(view);
            break;
        }

        default: {
            console.error('Unhandled message type', type);
        }
    }
}

document.addEventListener('DOMContentLoaded', function main() {
    Elements.canvas  = document.getElementById('cv');
    Elements.canvas2 = document.getElementById('cv-2');
    Elements.canvas3 = document.getElementById('cv-3');

    Elements.canvas3.width  = Elements.canvas2.width  = Elements.canvas.width  = 1920;
    Elements.canvas3.height = Elements.canvas2.height = Elements.canvas.height = 1080 * 3;
    
    Ctx  = Elements.canvas.getContext('2d');
    Ctx2 = Elements.canvas2.getContext('2d');
    Ctx3 = Elements.canvas3.getContext('2d');

    Ctx3.lineJoin = Ctx2.lineJoin = Ctx.lineJoin = 'round';
    Ctx3.lineCap  = Ctx2.lineCap  = Ctx.lineCap  = 'round';

    Elements.canvas.addEventListener('pointerdown', down);
    Elements.canvas.addEventListener('pointermove', move);

    Elements.slider       = document.getElementById('stroke-width');
    Elements.color_picker = document.getElementById('stroke-color');
    Elements.preview      = document.getElementById('stroke-preview');
    Elements.cursor       = document.getElementById('cursor');

    Elements.slider.value = DEFAULT_WIDTH;
    Elements.color_picker.value = DEFAULT_COLOR;
    Elements.cursor.style.width = DEFAULT_WIDTH + 'px';
    Elements.cursor.style.height = DEFAULT_WIDTH + 'px';

    Elements.color_picker.addEventListener('change', change_color);
    Elements.color_picker.addEventListener('input',  update_stroke_preview);
    Elements.slider      .addEventListener('change', change_slider);
    Elements.slider      .addEventListener('input',  update_stroke_preview);

    const path = new URL(window.location.href).pathname;

    Socket = new WebSocket(`ws://${window.location.hostname}:8080${path}`);
    Socket.addEventListener('message', on_message);

    update_stroke_preview();

    // Elements.canvas.ondragover = Elements.canvas.ondragenter = function(evt) {
    //     evt.preventDefault();
    //     return false;
    // };

    // Elements.canvas.ondrop = async function(evt) {
    //     evt.preventDefault();
    //     const file = evt.dataTransfer.files[0];
    //     const bitmap = await createImageBitmap(file);
    //     Ctx.drawImage(bitmap, evt.offsetX - Math.round(bitmap.width / 2), evt.offsetY - Math.round(bitmap.height / 2));
    //     return false;
    // };

    // Socket.addEventListener('close', on_close);
});