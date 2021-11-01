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

function full_redraw() {
    console.time('Full redraw');

    Ctx.clearRect(0, 0, Elements.canvas.width, Elements.canvas.height);

    for (const user_id in Users) {
        const user = Users[user_id];
        for (const stroke of user.finished_strokes) {
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

    console.timeEnd('Full redraw');
}

function draw_current_stroke(user_id) {
    const ctx = (user_id === Me ? Ctx2 : Ctx);
    const stroke = Users[user_id].current_stroke;

    if (stroke !== null) {
        const last = stroke.points.length - 1;
        ctx.lineWidth = Users[user_id].width;
        ctx.strokeStyle = Users[user_id].color;
        ctx.beginPath();
        if (stroke.points.length > 1) {
            ctx.moveTo(stroke.points[last - 1].x, stroke.points[last - 1].y);
            ctx.lineTo(stroke.points[last].x, stroke.points[last].y);
        } else {
            ctx.moveTo(stroke.points[last].x, stroke.points[last].y);
        }
        ctx.stroke();
    }
}

function stroke_stats(stroke, width) {
    let length = 0;
    let xmin = stroke.points[0].x, ymin = stroke.points[0].y;
    let xmax = xmin, ymax = ymin;

    for (let i = 0; i < stroke.points.length; ++i) {
        const point = stroke.points[i];
        if (point.x < xmin) xmin = point.x;
        if (point.y < ymin) ymin = point.y;
        if (point.x > xmax) xmax = point.x;
        if (point.y > ymax) ymax = point.y;

        if (i > 0) {
            const last = stroke.points[i - 1];
            const dx = point.x - last.x;
            const dy = point.y - last.y;
            length += Math.sqrt(dx * dx + dy * dy);
        }
    }

    xmin -= width;
    ymin -= width;
    xmax += width;
    ymax += width;

    const bbox = {
        'xmin': xmin,
        'ymin': ymin,
        'xmax': xmax,
        'ymax': ymax
    };

    return {
        'bbox': bbox,
        'length': length,
    };
}

function is_local_extrema(points, at) {
    let is_xmax = true;
    let is_xmin = true;
    let is_ymax = true;
    let is_ymin = true;

    const p = points[at];

    const from = Math.max(0, at - 5);
    const to = Math.min(points.length, at + 5);

    for (let i = from; i < to; ++i) {
        if (i !== at) {
            const other = points[i];
            if (other.x >= p.x) is_xmax = false;
            if (other.x <= p.x) is_xmin = false;
            if (other.y >= p.y) is_ymax = false;
            if (other.y <= p.y) is_ymin = false;
        }
    }
    
    const result = is_xmax || is_xmin || is_ymax || is_ymin;

    return result;
}

function process_stroke(points, bbox, length) {
    const result = [];

    if (points.length === 0) return result;

    const width = bbox.xmax - bbox.xmin;
    const height = bbox.ymax - bbox.ymin;
    const length_cutoff = 10;

    result.push({'x': points[0].x, 'y': points[0].y});

    // Ctx.strokeStyle = 'green';
    // Ctx.lineWidth = 10;
    // Ctx.beginPath();
    // Ctx.moveTo(points[0].x, points[0].y);
    // Ctx.lineTo(points[0].x, points[0].y);
    // Ctx.stroke();

    for (let i = 1; i < points.length; ++i) {
        const p = points[i];
        const last = result[result.length - 1];

        const dx = Math.abs(p.x - last.x);
        const dy = Math.abs(p.y - last.y);

        const dist2 = dx * dx + dy * dy;

        if (dist2 >= length_cutoff * length_cutoff) {
            result.push(p);
        } else if (is_local_extrema(points, i)) {
            result.push(p);
        }
    }

    result.push({'x': points[points.length - 1].x, 'y': points[points.length - 1].y});    

    console.log(points.length, result.length)

    return result;
}

function compute_splines2(points, closed) {
    const result = [];

    if (!closed) {
        result.push(points[0]);

        for (let i = 1; i < points.length - 2; ++i) {
            const p0 = points[i - 1];
            const p1 = points[i + 0];
            const p2 = points[i + 1];
            const p3 = points[i + 2];
            const spline_points = cm(p0, p1, p2, p3, 5);
            result.push(...spline_points);
         }

         result.push(points[points.length - 1]);
    } else {
        for (let i = 0; i < points.length; ++i) {
            const p0 = i > 0 ? points[i - 1] : points[points.length - 1];
            const p1 = points[i + 0];
            const p2 = points[(i + 1) % points.length];
            const p3 = points[(i + 2) % points.length];
            const spline_points = cm(p0, p1, p2, p3, 5);
            result.push(...spline_points);
         }
    }

     return result;
}

function is_straight_line(points, length) {
    const p0 = points[0];
    const p1 = points[points.length - 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;

    const straight_length = Math.sqrt(dx * dx + dy * dy);

    if ((Math.abs(length - straight_length) / length) < 0.08) {
        return true;
    }

    return false;
}

function is_closed_loop(points, length) {
    const p0 = points[0];
    const p1 = points[points.length - 1];

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;

    if (Math.sqrt(dx * dx + dy * dy) < length / 10) {
        return true;
    }

    return false;
}

function bake_current_stroke(user_id, stroke, bbox, length) {
    const processed_stroke = process_stroke(stroke.points, bbox, length);
    if (is_straight_line(processed_stroke, length)) {
        Ctx.lineWidth = 5;
        Ctx.strokeStyle = Users[user_id].color;

        Ctx.beginPath();
            Ctx.moveTo(processed_stroke[0].x, processed_stroke[0].y);
            Ctx.lineTo(processed_stroke[processed_stroke.length - 1].x, processed_stroke[processed_stroke.length - 1].y);
        Ctx.stroke();
        return;
    }

    let closed = false;
    if (is_closed_loop(processed_stroke, length)) {
        closed = true;
    }
    // const xs = [200, 400, 500, 700];
    // const ys = [500, 100, 100, 500];

    // const processed_stroke = [];
    // for (let i = 0; i < xs.length; ++i) {
    //     processed_stroke.push({'x': xs[i], 'y': ys[i]});
    // }
    // const splines = compute_splines(processed_stroke);

    const spline_points = compute_splines2(processed_stroke, closed);

    // console.log(processed_stroke);
    // console.log(spline_points)

    // Ctx.strokeStyle = 'green';
    // Ctx.lineWidth = 5;

    // Ctx.beginPath();
    //     for (let i = 0; i < spline_points.length; ++i) {
    //         Ctx.moveTo(spline_points[i].x, spline_points[i].y);
    //         Ctx.lineTo(spline_points[i].x, spline_points[i].y);
    //     }
    // Ctx.stroke();

    Ctx.lineWidth = 5;
    Ctx.strokeStyle = Users[user_id].color;

    Ctx.beginPath();
        Ctx.moveTo(spline_points[0].x, spline_points[0].y);
        for (let i = 1; i < spline_points.length; ++i) {
            const p = spline_points[i];
            Ctx.lineTo(p.x, p.y);
        }
    Ctx.stroke();

    // Ctx.strokeStyle = 'blue';
    // Ctx.lineWidth = 8;

    // Ctx.beginPath();
    //     for (let i = 0; i < processed_stroke.length; ++i) {
    //         Ctx.moveTo(processed_stroke[i].x, processed_stroke[i].y);
    //         Ctx.lineTo(processed_stroke[i].x, processed_stroke[i].y);
    //     }
    // Ctx.stroke();
}

////////////////////////////////////////
//////////////////// Splines
////////////////////////////////////////
function tma(A, B, C, D) {
    const N = D.length;

    // Прямой ход
    const C_prime = []
    const D_prime = []

    C_prime.push(C[0] / B[0])
    D_prime.push(D[0] / B[0])

    for (let i = 1; i < N; ++i) {
        const nom = C[i];
        const denom = B[i] - A[i] * C_prime[i - 1];
        C_prime.push(nom / denom);
    }

    for (let i = 1; i < N; ++i) {
        const nom = D[i] - A[i] * D_prime[i - 1];
        const denom = B[i] - A[i] * C_prime[i - 1];
        D_prime.push(nom / denom);
    }

    // Обратный ход
    const X = [];

    X.push(D_prime[N - 1]);

    for (let i = 1; i < N; ++i) {
        X.push(D_prime[N - 1 - i] - C_prime[N - 1 - i] * X[i - 1]);
    }

    X.reverse();

    return X;
}

function compute_c(xs, ys) {
    const N = xs.length;

    const a = []; // под главной диагональю
    const b = []; // главная диагональ
    const c = []; // над главной диагональю
    const d = []; // вектор правых частей

    // Заполним поддиагональ
    a.push(0);
    for (let i = 2; i < N - 1; ++i) {
        const h_i = xs[i] - xs[i - 1];
        a.push(h_i / 6);
    }

    // Заполним диагональ
    for (let i = 1; i < N - 1; ++i) {
        const h_i = xs[i] - xs[i - 1];
        const h_next = xs[i + 1] - xs[i];
        b.push((h_i + h_next) / 3);
    }

    // Заполним наддиагональ
    for (let i = 1; i < N - 2; ++i) {
        const h_next = xs[i + 1] - xs[i];
        c.push(h_next / 6);
    }
    c.push(0);

    // Заполним правые части
    for (let i = 1; i < N - 1; ++i) {
        const h_i = xs[i] - xs[i - 1];
        const h_next = xs[i + 1] - xs[i];
        const S1 = (ys[i + 1] - ys[i]) / h_next;
        const S2 = (ys[i] - ys[i - 1]) / h_i;
        d.push(S1 - S2);
    }

    // Применим метод прогонки
    const x = tma(a, b, c, d);

    // Добавим c_0 и c_N
    x.unshift(0);
    x.push(0);

    return x;
}

function compute_splines(points) {
    console.time('splines');

    const N = points.length;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);

    const a = [...ys];
    const c = compute_c(xs, ys);
    const d = [];
    const b = [];

    // Вычислим d
    for (let i = N - 1; i > 0; --i) {
        const h_i = xs[i] - xs[i - 1];
        d.unshift((c[i] - c[i - 1]) / h_i);
    }
    d.unshift(0);

    // Вычислим b
    for (let i = N - 1; i > 0; --i) {
        const h_i = xs[i] - xs[i - 1];
        const S1 = (a[i] - a[i - 1]) / h_i;
        const S2 = h_i * (2 * c[i] + c[i - 1]) / 6;
        b.unshift(S1 + S2);
    }
    b.unshift(0);

    console.timeEnd('splines');

    return { 'a': a, 'b': b, 'c': c, 'd': d };
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

    Users[Me].current_stroke.points.push({'x': x, 'y': y});
    Users[Me].current_stroke.id = stroke_id;
    
    const stroke_info = stroke_stats(Users[Me].current_stroke, Users[Me].width);
    const bbox = stroke_info.bbox;
    const length = stroke_info.length;

    bake_current_stroke(Me, Users[Me].current_stroke, bbox, length);
    Ctx2.clearRect(bbox.xmin, bbox.ymin, bbox.xmax - bbox.xmin, bbox.ymax - bbox.ymin);

    Users[Me].finished_strokes.push(Users[Me].current_stroke);
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

        (async () => { Socket.send(data); })();

        Users[Me].current_stroke.points.push({'x': x, 'y': y});
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

        full_redraw();
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

    // console.log(Users);
}

function handle_user_disconnect(view) {
    const user_id = view[1];
    delete Users[user_id];
    // console.log(Users)
}

function handle_user_stroke_end(view) {
    const user_id = view[1];
    const x = view[2];
    const y = view[3];
    Users[user_id].current_stroke.points.push({'x': x, 'y': y});
    Users[user_id].finished_strokes.push(Users[user_id].current_stroke);
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

function GetT(t, p0, p1) {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const a = dx * dx + dy * dy;
    const b = Math.pow(a, 0.25);

    return b + t;
}

function Lerp(a, b, t) {
    return a * t + b * (1 - t);
}

function cm(p0, p1, p2, p3, steps) {
    const points = [];
    const dt = 1 / steps;

    for (let t = 0; t <= 1; t += dt) {
        // const t0 = 0;
        // const t1 = GetT(t0, p0, p1);
        // const t2 = GetT(t1, p1, p2);
        // const t3 = GetT(t2, p2, p3);
        
        // const t = ti;

        // const a1x = (t1 - t) / (t1 - t0) * p0.x + (t - t0) / (t1 - t0) * p1.x;
        // const a1y = (t1 - t) / (t1 - t0) * p0.y + (t - t0) / (t1 - t0) * p1.y;

        // const a2x = (t2 - t) / (t2 - t1) * p1.x + (t - t1) / (t2 - t1) * p2.x;
        // const a2y = (t2 - t) / (t2 - t1) * p1.y + (t - t1) / (t2 - t1) * p2.y;

        // const a3x = (t3 - t) / (t3 - t2) * p2.x + (t - t2) / (t3 - t2) * p3.x;
        // const a3y = (t3 - t) / (t3 - t2) * p2.y + (t - t2) / (t3 - t2) * p3.y;

        // const b1x = (t2 - t) / (t3 - t0) * a1x + (t - t0) / (t2 - t0) * a2x;
        // const b1y = (t2 - t) / (t3 - t0) * a1y + (t - t0) / (t2 - t0) * a2y;
        
        // const b2x = (t3 - t) / (t3 - t1) * a2x + (t - t1) / (t3 - t1) * a3x;
        // const b2y = (t3 - t) / (t3 - t1) * a2y + (t - t1) / (t3 - t1) * a3y;

        // const cx = (t2 - t) / (t2 - t1) * b1x + (t - t1) / (t2 - t1) * b2x;
        // const cy = (t2 - t) / (t2 - t1) * b1y + (t - t1) / (t2 - t1) * b2y;

        const tt = t * t;
        const ttt = t * t * t;

        const t0 = -ttt + 2 * tt - t;
        const t1 = 3 * ttt - 5 * tt + 2;
        const t2 = - 3 * ttt + 4 * tt + t;
        const t3 = ttt - tt;

        const x = 0.5 * (t0 * p0.x + t1 * p1.x + t2 * p2.x + t3 * p3.x);
        const y = 0.5 * (t0 * p0.y + t1 * p1.y + t2 * p2.y + t3 * p3.y);

        points.push({'x': x, 'y': y});
    }

    return points;
}

function test_catmull_rom() {
    const p0 = {'x': 100, 'y': 100};
    const p1 = {'x': 550, 'y': 550};
    const p2 = {'x': 600, 'y': 300};
    const p3 = {'x': 820, 'y': 180};

    const points = cm(p0, p1, p2, p3, 30);

    Ctx.lineWidth = 5;
    Ctx.strokeStyle = 'red';

    Ctx.beginPath();
    Ctx.moveTo(p0.x, p0.y);
    Ctx.lineTo(p0.x, p0.y);
    Ctx.stroke();

    Ctx.beginPath();
    Ctx.moveTo(p1.x, p1.y);
    Ctx.lineTo(p1.x, p1.y);
    Ctx.stroke();

    Ctx.beginPath();
    Ctx.moveTo(p2.x, p2.y);
    Ctx.lineTo(p2.x, p2.y);
    Ctx.stroke();

    Ctx.beginPath();
    Ctx.moveTo(p3.x, p3.y);
    Ctx.lineTo(p3.x, p3.y);
    Ctx.stroke();

    Ctx.strokeStyle = 'blue';
    Ctx.lineWidth = 3;
    Ctx.beginPath();
    Ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; ++i) {
        Ctx.lineTo(points[i].x, points[i].y);
    }
    Ctx.stroke();
}

document.addEventListener('DOMContentLoaded', function main() {
    Elements.canvas  = document.getElementById('cv');
    Elements.canvas2 = document.getElementById('cv-2');

    Elements.canvas2.width  = Elements.canvas.width  = 1920;
    Elements.canvas2.height = Elements.canvas.height = 1080 * 3;
    
    Ctx  = Elements.canvas.getContext('2d');
    Ctx2 = Elements.canvas2.getContext('2d');

    Ctx2.lineJoin = Ctx.lineJoin = 'round';
    Ctx2.lineCap  = Ctx.lineCap  = 'round';

    Elements.canvas.addEventListener('pointerdown', down);
    Elements.canvas.addEventListener('pointermove', move);

    Elements.slider = document.getElementById('stroke-width');
    Elements.color_picker = document.getElementById('stroke-color');
    Elements.preview = document.getElementById('stroke-preview');

    Elements.slider.value = DEFAULT_WIDTH;
    Elements.color_picker.value = DEFAULT_COLOR;

    // document.getElementById('change-to-pencil').addEventListener('click', () => { change_tool_to('pencil'); })
    // document.getElementById('change-to-eraser').addEventListener('click', () => { change_tool_to('eraser'); })

    Elements.color_picker.addEventListener('change', change_color);
    Elements.color_picker.addEventListener('input',  update_stroke_preview);
    Elements.slider      .addEventListener('change', change_slider);
    Elements.slider      .addEventListener('input',  update_stroke_preview);

    // change_tool_to('pencil');

    const path = new URL(window.location.href).pathname;

    Socket = new WebSocket(`ws://${window.location.hostname}:8080${path}`);
    Socket.addEventListener('message', on_message);

    update_stroke_preview();


    // test_catmull_rom();
    // Socket.addEventListener('close', on_close);
});