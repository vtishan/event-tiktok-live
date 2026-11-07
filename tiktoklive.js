const KenhSocket = require('ws');
const { EventEmitter: BoPhat } = require('node:events');
const { randomBytes: taoNgauNhien } = require('node:crypto');
const { gunzipSync: giaiNen } = require('node:zlib');
const { createInterface: taoNhap } = require('node:readline/promises');

class DuLieu {
    static trinhDuyet = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
    static mien = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
    static maHopLe(giaTri) { return giaTri && String(giaTri) !== '0' ? String(giaTri) : ''; }
    static lamSach(giaTri) { return String(giaTri ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' '); }
    static nguoiDung(nguoi) {
        return {
            id: this.maHopLe(nguoi?.id) || this.maHopLe(nguoi?.idStr),
            username: nguoi?.displayId || '',
            nickname: nguoi?.nickname || nguoi?.displayId || 'Người xem',
        };
    }
    static ghiNho(boNho, khoa, giaTri, gioiHan = 10000) {
        boNho.set(khoa, giaTri);
        if (boNho.size > gioiHan) boNho.delete(boNho.keys().next().value);
    }
    static maHoa(luocDo, duLieu) {
        return Buffer.from(luocDo.encode({ ...luocDo.decode(new Uint8Array()), ...duLieu }).finish());
    }
    static async taiJson(diaChi, cookie) {
        const phanHoi = await fetch(diaChi, {
            headers: { 'User-Agent': this.trinhDuyet, Cookie: cookie, Referer: 'https://www.tiktok.com/live' },
            signal: AbortSignal.timeout(15000),
        });
        if (!phanHoi.ok) throw new Error(`TikTok trả HTTP ${phanHoi.status}`);
        try { return await phanHoi.json(); }
        catch { throw new Error('TikTok không trả dữ liệu JSON. Hãy thử lại sau.'); }
    }
    static async layTaiKhoan(dauVao) {
        let diaChi = String(dauVao || '').trim();
        if (/^(?:(?:www|m|vm|vt)\.)?tiktok\.com\//i.test(diaChi)) diaChi = `https://${diaChi}`;
        if (!/^https?:\/\//i.test(diaChi)) {
            diaChi = diaChi.replace(/^@/, '');
            if (!/^[a-zA-Z0-9_.]+$/.test(diaChi)) throw new Error('Link hoặc tên tài khoản TikTok không hợp lệ.');
            return diaChi;
        }
        let lienKet = new URL(diaChi);
        for (let lan = 0; lan < 6; lan++) {
            if (!this.mien.has(lienKet.hostname) || lienKet.username || lienKet.password || !['http:', 'https:'].includes(lienKet.protocol)) {
                throw new Error('Hãy nhập link TikTok LIVE hoặc trang cá nhân TikTok.');
            }
            const ketQua = lienKet.pathname.match(/^\/@([a-zA-Z0-9_.]+)(?:\/live)?\/?$/);
            if (ketQua) return ketQua[1];
            if (!/^(vm|vt)\.tiktok\.com$/.test(lienKet.hostname) && !lienKet.pathname.startsWith('/t/')) break;
            lienKet.protocol = 'https:';
            const phanHoi = await fetch(lienKet, {
                redirect: 'manual', headers: { 'User-Agent': this.trinhDuyet }, signal: AbortSignal.timeout(15000),
            });
            await phanHoi.body?.cancel();
            const chuyenHuong = phanHoi.headers.get('location');
            if (phanHoi.status < 300 || phanHoi.status >= 400 || !chuyenHuong) break;
            lienKet = new URL(chuyenHuong, lienKet);
        }
        throw new Error('Không tìm được tài khoản. Hãy dùng https://www.tiktok.com/@username/live');
    }
    static taoDuongDan(maPhong) {
        const diaChi = new URL(process.env.TIKTOK_WS_URL || 'wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/');
        if (!process.env.TIKTOK_WS_URL) {
            diaChi.search = new URLSearchParams({
                version_code: '180800', device_platform: 'web', cookie_enabled: 'true',
                screen_width: '1280', screen_height: '720', browser_language: 'vi', browser_platform: 'Win32',
                browser_name: 'Mozilla', browser_version: this.trinhDuyet.slice(8), browser_online: 'true',
                tz_name: 'Asia/Saigon', app_name: 'tiktok_web', sup_ws_ds_opt: '1', update_version_code: '2.0.0',
                compress: 'gzip', webcast_language: 'vi-VN', ws_direct: '1', aid: '1988', live_id: '12',
                app_language: 'vi-VN', client_enter: '1', identity: 'audience', history_comment_count: '0',
                last_rtt: '0', heartbeat_duration: '10000', resp_content_type: 'protobuf', did_rule: '3',
            });
            diaChi.searchParams.append('version_code', '270000');
        }
        diaChi.searchParams.set('room_id', maPhong);
        return diaChi;
    }
}

class BoGiaiMa {
    static loaiTin = {
        WebcastChatMessage: 'chat', WebcastGiftMessage: 'gift', WebcastLikeMessage: 'like',
        WebcastMemberMessage: 'member', WebcastSocialMessage: 'social',
        WebcastRoomUserSeqMessage: 'viewers', WebcastControlMessage: 'control',
    };
    #giaoThuc;
    #danhSachQua;
    #daNhan = new Map();
    #chuoiQua = new Map();
    #luotXem = null;

    constructor(giaoThuc, danhSachQua = []) {
        this.#giaoThuc = giaoThuc;
        this.#danhSachQua = new Map(danhSachQua.map(qua => [String(qua.id), qua]));
    }
    giaiMa(tinNhan) {
        const loai = BoGiaiMa.loaiTin[tinNhan.method];
        const luocDo = this.#giaoThuc[tinNhan.method];
        if (!loai || !luocDo) return [];
        const duLieu = luocDo.decode(tinNhan.payload);
        const maTin = DuLieu.maHopLe(tinNhan.msgId) || DuLieu.maHopLe(duLieu.common?.msgId);
        if (maTin && loai !== 'gift') {
            const khoa = `${tinNhan.method}:${maTin}`;
            if (this.#daNhan.has(khoa)) return [];
            DuLieu.ghiNho(this.#daNhan, khoa, true);
        }
        const suKien = { type: loai, messageId: maTin, isHistory: !!tinNhan.isHistory, user: DuLieu.nguoiDung(duLieu.user) };
        switch (loai) {
            case 'chat': return [{ ...suKien, comment: duLieu.content }];
            case 'gift': return this.#docQua(suKien, duLieu);
            case 'like': return [{ ...suKien, count: duLieu.count, total: duLieu.total }];
            case 'member': return [{ ...suKien, memberCount: duLieu.memberCount }];
            case 'social': {
                const khoa = duLieu.common?.displayText?.key?.toLowerCase() || '';
                return [{ ...suKien, type: khoa.includes('follow') ? 'follow' : khoa.includes('share') ? 'share' : 'social', action: duLieu.action, shareCount: duLieu.shareCount }];
            }
            case 'viewers':
                if (this.#luotXem === duLieu.total) return [];
                this.#luotXem = duLieu.total;
                return [{ ...suKien, count: duLieu.total, totalUser: duLieu.totalUser }];
            case 'control': return [{ ...suKien, action: duLieu.action, tips: duLieu.tips }];
            default: return [];
        }
    }
    #docQua(suKien, duLieu) {
        const maQua = DuLieu.maHopLe(duLieu.giftId) || DuLieu.maHopLe(duLieu.gift?.id);
        const thongTin = this.#danhSachQua.get(maQua);
        const tenQua = duLieu.gift?.name || thongTin?.name || `Quà #${maQua || '?'}`;
        const giaQua = duLieu.gift?.diamondCount || thongTin?.diamond_count || 0;
        const maNhom = DuLieu.maHopLe(duLieu.groupId);
        const maDon = DuLieu.maHopLe(duLieu.orderId);
        const loaiQua = duLieu.gift?.type || thongTin?.type;
        const laChuoi = loaiQua === 1 || duLieu.gift?.combo === true || (!duLieu.gift && !thongTin && !!maNhom);
        const ketThuc = !laChuoi || duLieu.repeatEnd === 1;
        const nguoiNhan = DuLieu.nguoiDung(duLieu.toUser);
        let soLan = Math.max(1, Number(duLieu.repeatCount) || 1);
        if (suKien.messageId) {
            const khoa = `gift:${suKien.messageId}` + (laChuoi ? `:${maNhom}:${soLan}:${ketThuc}` : '');
            if (this.#daNhan.has(khoa)) return [];
            DuLieu.ghiNho(this.#daNhan, khoa, true);
        }
        let soTang = soLan;
        let baoHet = ketThuc;
        if (laChuoi) {
            const khoa = [suKien.user.id || suKien.user.username, nguoiNhan.id, maQua, maNhom || maDon || 'current'].join(':');
            let truocDo = this.#chuoiQua.get(khoa);
            if (truocDo?.ketThuc && !maNhom && !maDon) truocDo = undefined;
            if (truocDo?.ketThuc) return [];
            // Số lần là tổng chuỗi: 1 -> 3 -> 3 kết thúc chỉ tăng 1 + 2 + 0.
            soLan = Math.max(soLan, truocDo?.soLan || 0);
            soTang = Math.max(0, soLan - (truocDo?.soLan || 0));
            baoHet = ketThuc && !truocDo?.ketThuc;
            DuLieu.ghiNho(this.#chuoiQua, khoa, { soLan, ketThuc }, 5000);
        }
        const qua = {
            ...suKien, giftId: maQua, giftName: tenQua, count: soTang, repeatCount: soLan,
            repeatEnd: ketThuc, isCombo: laChuoi, groupId: maNhom, diamondCount: giaQua,
            diamonds: soTang * giaQua, recipient: nguoiNhan,
        };
        return [...(soTang > 0 ? [qua] : []), ...(baoHet ? [{ ...qua, type: 'giftEnd', count: 0 }] : [])];
    }
}

class KetNoiLive extends BoPhat {
    #giaoThuc;
    #boGiaiMa;
    #kenh;
    #thuTu = 1;
    #nhipTim;
    #choVao;
    #choDong;
    #daDung = false;
    #coLoi = false;
    #daVao = false;
    #layLichSu;
    phong;
    thongKe = { frames: 0, messages: 0, comments: 0, gifts: 0, likes: 0, acks: 0 };

    constructor(layLichSu = false) { super(); this.#layLichSu = layLichSu; }
    async ketNoi(dauVao) {
        if (this.#kenh || this.#daDung) throw new Error('Hãy tạo kết nối mới để theo dõi phòng khác.');
        const taiKhoan = await DuLieu.layTaiKhoan(dauVao);
        this.#giaoThuc = await import('tiktok-live-proto/v3');
        const phanHoi = await fetch('https://www.tiktok.com/live', {
            headers: { 'User-Agent': DuLieu.trinhDuyet, 'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8' },
            signal: AbortSignal.timeout(15000),
        });
        await phanHoi.arrayBuffer();
        if (!phanHoi.ok) throw new Error(`Không tải được TikTok LIVE: HTTP ${phanHoi.status}`);
        const cookie = phanHoi.headers.getSetCookie().filter(giaTri => giaTri.startsWith('ttwid='))
            .map(giaTri => giaTri.split(';', 1)[0]).join('; ');
        if (!cookie) throw new Error('TikTok không cấp cookie phiên ttwid. Hãy thử lại sau.');
        const diaChi = new URL('https://www.tiktok.com/api-live/user/room/');
        diaChi.search = new URLSearchParams({ aid: '1988', uniqueId: taiKhoan, sourceType: '54' });
        const ketQua = await DuLieu.taiJson(diaChi, cookie);
        const nguoi = ketQua.data?.user;
        const phong = ketQua.data?.liveRoom;
        if (!nguoi?.roomId || String(nguoi.roomId) === '0' || Number(phong?.status ?? nguoi.status) !== 2) {
            throw new Error(`@${taiKhoan} hiện không live hoặc TikTok không cho đọc phòng này.`);
        }
        const maPhong = String(nguoi.roomId);
        if (!/^\d+$/.test(maPhong)) throw new Error('TikTok trả room_id không hợp lệ.');
        this.phong = { username: taiKhoan, roomId: maPhong, title: phong?.title || nguoi.nickname || 'TikTok LIVE' };
        let danhSachQua = [];
        try {
            const diaChiQua = new URL('https://webcast.tiktok.com/webcast/gift/list/');
            diaChiQua.search = new URLSearchParams({ aid: '1988', room_id: maPhong });
            const ketQuaQua = await DuLieu.taiJson(diaChiQua, cookie);
            if (!Array.isArray(ketQuaQua.data?.gifts)) throw new Error('Thiếu danh sách quà');
            danhSachQua = ketQuaQua.data.gifts;
        } catch (loi) { this.#canhBao(`Chưa lấy được tên quà; sẽ dùng dữ liệu trong sự kiện. ${loi.message}`); }
        if (this.#daDung) return this;
        this.#boGiaiMa = new BoGiaiMa(this.#giaoThuc, danhSachQua);
        this.#kenh = new KenhSocket(DuLieu.taoDuongDan(maPhong), {
            origin: 'https://www.tiktok.com', headers: { 'User-Agent': DuLieu.trinhDuyet, Cookie: cookie }, handshakeTimeout: 15000,
        });
        this.#kenh.on('open', () => this.#vaoPhong());
        this.#kenh.on('message', (duLieu, laNhiPhan) => this.#nhanKhung(duLieu, laNhiPhan));
        this.#kenh.on('unexpected-response', (yeuCau, phanHoi) => {
            this.#coLoi = true;
            this.#canhBao(`TikTok từ chối WebSocket: HTTP ${phanHoi.statusCode}; handshake ${phanHoi.headers['handshake-status'] || '?'}; ${phanHoi.headers['handshake-msg'] || 'không rõ lý do'}`);
            phanHoi.resume();
            this.#kenh.terminate();
        });
        this.#kenh.on('error', loi => {
            if (!this.#daDung && !this.#coLoi) { this.#coLoi = true; this.#canhBao(loi); }
        });
        this.#kenh.on('close', (maDong, lyDo) => {
            this.#xoaHen();
            this.emit('disconnected', { code: maDong, reason: lyDo.toString(), stopping: this.#daDung, failed: this.#coLoi, stats: { ...this.thongKe } });
        });
        return this;
    }
    #canhBao(loi) { this.emit('warning', loi instanceof Error ? loi : new Error(loi)); }
    #guiKhung(loai, duLieu, boSung = {}) {
        if (this.#kenh?.readyState === KenhSocket.OPEN) {
            this.#kenh.send(DuLieu.maHoa(this.#giaoThuc.WebcastPushFrame, { payloadEncoding: 'pb', payloadType: loai, payload: duLieu, ...boSung }));
        }
    }
    #guiNhip() {
        this.#guiKhung('hb', DuLieu.maHoa(this.#giaoThuc.HeartBeatMessage, { roomId: this.phong.roomId, sendPacketSeqId: String(this.#thuTu++) }));
    }
    #vaoPhong() {
        this.#guiKhung('im_enter_room', DuLieu.maHoa(this.#giaoThuc.WebcastImEnterRoomMessage, {
            roomId: this.phong.roomId, liveId: '12', identity: 'audience', filterWelcomeMsg: '0',
            enterUniqueId: (taoNgauNhien(8).readBigUInt64BE() >> 1n).toString(),
        }));
        this.#guiNhip();
        this.#nhipTim = setInterval(() => this.#guiNhip(), 10000);
        this.#choVao = setTimeout(() => {
            this.#coLoi = true;
            this.#canhBao('TikTok chưa xác nhận vào phòng sau 15 giây.');
            this.#kenh.terminate();
        }, 15000);
    }
    #nhanKhung(duLieu, laNhiPhan) {
        this.thongKe.frames++;
        if (process.env.TIKTOK_RAW === '1') this.emit('rawFrame', duLieu);
        if (!laNhiPhan) return;
        let danhSach;
        try {
            const khung = this.#giaoThuc.WebcastPushFrame.decode(duLieu);
            if (!['msg', 'im_enter_room_resp'].includes(khung.payloadType)) return;
            const noiDung = khung.payload[0] === 0x1f && khung.payload[1] === 0x8b ? giaiNen(khung.payload) : khung.payload;
            const goiTin = this.#giaoThuc.ProtoMessageFetchResult.decode(noiDung);
            if (goiTin.needAck) {
                this.#guiKhung('ack', Buffer.from(goiTin.internalExt || '-'), { logId: khung.logId });
                this.thongKe.acks++;
            }
            if (khung.payloadType === 'im_enter_room_resp' && !this.#daVao) {
                this.#daVao = true;
                clearTimeout(this.#choVao);
                this.emit('connected', this.phong);
            }
            danhSach = goiTin.messages;
            this.thongKe.messages += danhSach.length;
        } catch (loi) { this.#canhBao(`Không giải mã được khung: ${loi.message}`); return; }
        for (const tinNhan of danhSach) {
            this.emit('rawMessage', tinNhan);
            if (tinNhan.isHistory && !this.#layLichSu) continue;
            let suKien;
            try { suKien = this.#boGiaiMa.giaiMa(tinNhan); }
            catch (loi) { this.#canhBao(`Không giải mã được ${tinNhan.method}: ${loi.message}`); continue; }
            for (const muc of suKien) {
                muc.roomId = this.phong.roomId;
                if (muc.type === 'chat') this.thongKe.comments++;
                if (muc.type === 'gift') this.thongKe.gifts += muc.count;
                if (muc.type === 'like') this.thongKe.likes += muc.count;
                this.emit(muc.type, muc);
                this.emit('event', muc);
            }
        }
    }
    #xoaHen() {
        clearInterval(this.#nhipTim);
        clearTimeout(this.#choVao);
        clearTimeout(this.#choDong);
    }
    dung() {
        if (this.#daDung) return;
        this.#daDung = true;
        this.#xoaHen();
        if (!this.#kenh || [KenhSocket.CLOSED, KenhSocket.CLOSING].includes(this.#kenh.readyState)) return;
        if (this.#kenh.readyState === KenhSocket.CONNECTING) return this.#kenh.terminate();
        this.#kenh.close(1000, 'Dừng theo dõi');
        this.#choDong = setTimeout(() => this.#kenh.terminate(), 3000);
        this.#choDong.unref();
    }
}

class UngDung {
    #ketNoi = new KetNoiLive();
    static hienThi(suKien) {
        const thoiGian = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Saigon', hour12: false });
        const ten = DuLieu.lamSach(suKien.user?.nickname || suKien.user?.username || 'Người xem');
        const nguoiGui = ten + (suKien.user?.username ? ` (@${DuLieu.lamSach(suKien.user.username)})` : '');
        const noiDung = {
            chat: () => `${nguoiGui}: ${DuLieu.lamSach(suKien.comment)}`,
            gift: () => `${nguoiGui} tặng ${DuLieu.lamSach(suKien.giftName)} x${suKien.count}` + (suKien.isCombo ? ` (combo x${suKien.repeatCount})` : ''),
            giftEnd: () => suKien.isCombo ? `${nguoiGui}: kết thúc combo ${DuLieu.lamSach(suKien.giftName)} x${suKien.repeatCount}` : null,
            like: () => `${nguoiGui} thả ${suKien.count} tim, tổng ${suKien.total}`,
            member: () => `${nguoiGui} vào phòng`,
            follow: () => `${nguoiGui} theo dõi chủ live`,
            share: () => `${nguoiGui} chia sẻ live`,
            viewers: () => `Đang xem: ${suKien.count}`,
            control: () => suKien.tips ? DuLieu.lamSach(suKien.tips) : null,
        }[suKien.type]?.();
        if (noiDung) console.log(`[${thoiGian}] ${noiDung}`);
    }
    async chay() {
        if (process.argv.includes('--help')) {
            console.log('Chạy node tiktok-live.cjs rồi nhập link, hoặc: node tiktok-live.cjs @username');
            return;
        }
        let dauVao = process.argv[2] || process.env.TIKTOK_USERNAME;
        if (!dauVao) {
            const banNhap = taoNhap({ input: process.stdin, output: process.stdout });
            try { dauVao = await banNhap.question('Nhập link TikTok LIVE: '); }
            finally { banNhap.close(); }
        }
        const dung = () => this.#ketNoi.dung();
        this.#ketNoi.on('event', UngDung.hienThi);
        this.#ketNoi.on('warning', loi => console.error(DuLieu.lamSach(loi.message)));
        this.#ketNoi.on('connected', phong => {
            console.log(`Đang theo dõi @${phong.username}: ${DuLieu.lamSach(phong.title)} (phòng ${phong.roomId})`);
            console.log('Ctrl+C để dừng.');
        });
        this.#ketNoi.on('rawFrame', duLieu => console.log('Khung gốc:', duLieu));
        this.#ketNoi.on('disconnected', thongTin => {
            process.removeListener('SIGINT', dung);
            process.removeListener('SIGTERM', dung);
            console.log(`Đã đóng kết nối (${thongTin.code})`, thongTin.stats);
            if (!thongTin.stopping && (thongTin.failed || thongTin.code !== 1000)) process.exitCode = 1;
        });
        process.once('SIGINT', dung);
        process.once('SIGTERM', dung);
        console.log('Đang tìm phòng live và kết nối...');
        try { await this.#ketNoi.ketNoi(dauVao); }
        catch (loi) {
            process.removeListener('SIGINT', dung);
            process.removeListener('SIGTERM', dung);
            this.#ketNoi.dung();
            throw loi;
        }
    }
}

new UngDung().chay().catch(loi => {
    console.error(DuLieu.lamSach(loi.message));
    process.exitCode = 1;
});
