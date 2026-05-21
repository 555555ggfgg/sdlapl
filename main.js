var strSyncingFs = 'Syncing FS...';
var strDone = 'Done.';
var strDeleting = 'Deleting...';
var strNoSave = 'Cannot find saved games to download';
var strInit = 'Initializing...';
var strDelConfirm = "This will DELETE your game data and saved games stored in browser cache. Type 'YES' to continue.";
var strTips = "Note: Avoid using uppercase letters in the configuration file when specifying paths and file names.";

var userLang = navigator.language || navigator.userLanguage;
if (userLang === 'zh-CN' || userLang.startsWith('zh-Hans') ) {
    strSyncingFs = '正在同步文件系统...';
    strDone = '完成。';
    strDeleting = '正在删除...';
    strNoSave = '无法找到可下载的游戏存档！';
    strInit = '正在初始化...';
    strDelConfirm = '此操作将删除您浏览器缓存中保存的数据文件及存档。请输入 "YES" 继续：';
    strTips = "注意！配置文件内的路径和文件名 不能 包含大写字母。";
} else if (userLang === 'zh-TW' || userLang.startsWith('zh-Hant') ) {
    strSyncingFs = '正在同步檔案系統...';
    strDone = '完成。';
    strDeleting = '正在刪除...';
    strNoSave = '無法找到可下載的遊戲記錄！';
    strInit = '正在初始化...';
    strDelConfirm = '此操作將刪除您瀏覽器緩存中保存的遊戲資料檔及記錄。請輸入 "YES" 繼續：';
    strTips = "請注意：在設定檔中指定路徑和檔案名稱時，請勿使用大寫字母。";
}

var statusElement = document.getElementById('status');
var progressElement = document.getElementById('progress');
var spinnerElement = document.getElementById('spinner');
var tipsElement;
window.addEventListener('load', function () {
    tipsElement = document.getElementById('tips');
    tipsElement.textContent = strTips;
})

var DATA_7Z_URL = window.DATA_7Z_URL || 'sdlpal.data.7z';
var SEVENZ_WASM_CDN = window.SEVENZ_WASM_CDN || 'https://cdn.jsdelivr.net/npm/7z-wasm@1.2.0/7zz.es6.min.js';

var Module = {
    preRun: [],
    postRun: [],
    print: function(text) {
        console.log(text);
    },
    printErr: function(text) {
        console.error(text);
    },
    canvas: (function() {
        var canvas = document.getElementById('canvas');
        canvas.addEventListener("webglcontextlost", function(e) { alert('WebGL context lost. You will need to reload the page.'); e.preventDefault(); }, false);
        return canvas;
    })(),
    setStatus: function(text) {
        if (!Module.setStatus.last) Module.setStatus.last = { time: Date.now(), text: '' };
        if (text === Module.setStatus.last.text) return;
        if (text === '' && Module.setStatus.last.text == strSyncingFs) return;
        var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
        var now = Date.now();
        if (m && now - Module.setStatus.last.time < 30) return;
        Module.setStatus.last.time = now;
        Module.setStatus.last.text = text;
        if (m) {
            text = m[1];
            progressElement.value = parseInt(m[2])*100;
            progressElement.max = parseInt(m[4])*100;
            progressElement.hidden = false;
            spinnerElement.hidden = false;
        } else {
            progressElement.value = null;
            progressElement.max = null;
            progressElement.hidden = true;
            if (!text) spinnerElement.style.display = 'none';
        }
        statusElement.innerHTML = text;
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        Module.setStatus(left ? 'Preparing... (' + (this.totalDependencies-left) + '/' + this.totalDependencies + ')' : 'All downloads complete.');
    },
    onRuntimeInitialized:function() {
        onRuntimeInitialized();
    }
};

function onRuntimeInitialized() {
    try {
        FS.mkdir('/saves');
    } catch (e) {}
    FS.mount(IDBFS, {}, '/saves');
    Module.setStatus(strSyncingFs);
    spinnerElement.style.display = 'inline-block';
    FS.syncfs(true, function (err) {
        spinnerElement.style.display = 'none';
        Module.setStatus(strDone);
        loadDataFrom7z();
    });
}

function copyDir(szFS, szPath, gamePath) {
    var entries;
    try {
        entries = szFS.readdir(szPath);
    } catch (e) {
        return;
    }
    for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        if (name === '.' || name === '..') continue;
        var szFull = szPath + '/' + name;
        var gameFull = gamePath + '/' + name;
        var stat;
        try {
            stat = szFS.stat(szFull);
        } catch (e) {
            continue;
        }
        if (stat.mode & 0040000) {
            try { FS.mkdir(gameFull); } catch (e) {}
            copyDir(szFS, szFull, gameFull);
        } else {
            var data = szFS.readFile(szFull, { encoding: 'binary' });
            FS.writeFile(gameFull, data);
        }
    }
}

async function loadDataFrom7z() {
    Module.setStatus('Downloading data...');
    var resp;
    try {
        resp = await fetch(DATA_7Z_URL);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
    } catch (e) {
        Module.printErr('Failed to download ' + DATA_7Z_URL + ': ' + e);
        Module.setStatus('Data download failed');
        return;
    }

    var contentLength = resp.headers.get('Content-Length');
    var total = contentLength ? parseInt(contentLength) : 0;
    var reader = resp.body.getReader();
    var chunks = [];
    var received = 0;
    while (true) {
        var result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        received += result.value.length;
        if (total) {
            Module.setStatus('Downloading data... (' + Math.round(received / total * 100) + '%)');
        }
    }
    var buffer = new Uint8Array(received);
    var pos = 0;
    for (var chunk of chunks) {
        buffer.set(chunk, pos);
        pos += chunk.length;
    }
    chunks = null;

    Module.setStatus('Loading 7z-wasm...');
    var SevenZip;
    try {
        SevenZip = (await import(SEVENZ_WASM_CDN)).default;
    } catch (e) {
        Module.printErr('Failed to load 7z-wasm from CDN: ' + e);
        Module.setStatus('Failed to load decompressor');
        return;
    }

    Module.setStatus('Decompressing...');
    var sevenZip;
    try {
        sevenZip = await SevenZip();
    } catch (e) {
        Module.printErr('Failed to init 7z-wasm: ' + e);
        Module.setStatus('Failed to init decompressor');
        return;
    }

    try {
        var archiveName = 'data.7z';
        var stream = sevenZip.FS.open(archiveName, 'w+');
        sevenZip.FS.write(stream, buffer, 0, buffer.length);
        sevenZip.FS.close(stream);
        buffer = null;

        Module.setStatus('Extracting...');
        sevenZip.callMain(['x', archiveName, '-o' + '/']);

        Module.setStatus('Copying files...');
        try { FS.mkdir('/data'); } catch (e) {}
        copyDir(sevenZip.FS, '/data', '/data');
    } catch (e) {
        Module.printErr('Failed to decompress: ' + e);
        Module.setStatus('Data extraction failed');
        return;
    }

    Module.setStatus('Done.');
    launch();
}

function clearData() {
    if (window.prompt(strDelConfirm) === "YES") {
        var doDelete = function(path) {
            Object.keys(FS.lookupPath(path).node.contents).forEach(element => {
                var stat = FS.stat(path + '/' + element);
                if (stat.mode & 0040000) {
                    doDelete(path + '/' + element);
                    FS.rmdir(path + '/' + element);
                } else {
                    FS.unlink(path + '/' + element);
                }
            });
        };
        Module.setStatus(strDeleting);
        spinnerElement.style.display = 'inline-block';
        doDelete('/saves');
        Module.setStatus(strSyncingFs);
        FS.syncfs(false, function (err) {
            spinnerElement.style.display = 'none';
            Module.setStatus(strDone);
        });
    }
}

function downloadSaves() {
    var zip = new JSZip();
    var hasData = false;
    Object.keys(FS.lookupPath('/saves').node.contents).forEach(element => {
        if (element.endsWith('.rpg')) {
            var array = FS.readFile('/saves/' + element);
            zip.file(element, array);
            hasData = true;
        }
    });
    if (!hasData) {
        window.alert(strNoSave);
        return;
    }
    zip.generateAsync({type:"base64"}).then(function (base64) {
        window.location = "data:application/zip;base64," + base64;
    }, function (err) {
        Module.printErr(err);
    });
}

async function runGame() {
    mainFunc = Module.cwrap('EMSCRIPTEN_main', 'number', ['number', 'number'], {async:true});
    mainFunc(0, 0);
}

function launch() {
    document.getElementById('controls').style = "display:none";
    tipsElement.style = "display:none";
    runGame();
}

Module.setStatus(strInit);
window.onerror = function(event) {
    Module.setStatus('Exception thrown, see JavaScript console');
    spinnerElement.style.display = 'none';
    Module.setStatus = function(text) {
        if (text) Module.printErr('[post-exception status] ' + text);
    };
};
