let solveId = 0;
let solveCallbacks = {};

let solverIframe = document.createElement('iframe');
solverIframe.style.display = 'none';
solverIframe.src = `chrome-extension://${chrome.runtime.id}/sandbox.html`;
document.body.appendChild(solverIframe);

function solveChallenge(path, method) {
    return new Promise((resolve, reject) => {
        let id = solveId++;
        solveCallbacks[id] = { resolve, reject };
        solverIframe.contentWindow.postMessage({ action: 'solve', id, path, method }, '*');
    });
}

let _fetch = window.fetch;
window.fetch = async function(url, options) {
    if(!url.startsWith('https://twitter.com/i/api') && !url.startsWith('https://api.twitter.com')) return _fetch(url, options);
    if(!options) options = {};
    if(!options.headers) options.headers = {};
    if(!options.headers['x-twitter-auth-type']) {
        options.headers['x-twitter-auth-type'] = 'OAuth2Session';
    }
    if(!options.headers['x-twitter-active-user']) {
        options.headers['x-twitter-active-user'] = 'yes';
    }
    if(!options.headers['X-Client-UUID']) {
        options.headers['X-Client-UUID'] = OLDTWITTER_CONFIG.deviceId;
    }
    let parsedUrl = new URL(url);
    try {
        let solved = await solveChallenge(parsedUrl.pathname, options.method ? options.method.toUpperCase() : 'GET');
        options.headers['x-client-transaction-id'] = solved;
    } catch (e) {
        console.error(`Error solving challenge for ${url}:`);
        console.error(e);
    }
    if(options.method && options.method.toUpperCase() === 'POST' && typeof options.body === 'string') {
        options.headers['Content-Length'] = options.body.length;
    }

    return _fetch(url, options);
}

window.addEventListener('message', e => {
    if(e.source !== solverIframe.contentWindow) return;
    let data = e.data;
    if(data.action === 'solved') {
        let { id, result } = data;
        if(solveCallbacks[id]) {
            solveCallbacks[id].resolve(result);
            delete solveCallbacks[id];
        }
    } else if(data.action === 'error') {
        let { id, error } = data;
        if(solveCallbacks[id]) {
            solveCallbacks[id].reject(error);
            delete solveCallbacks[id];
        }
    }
});

(async () => {
    try {
        let homepageData = await _fetch('https://twitter.com/').then(res => res.text());
        let dom = new DOMParser().parseFromString(homepageData, 'text/html');
        let anims = Array.from(dom.querySelectorAll('svg[id^="loading-x"]')).map(svg => svg.outerHTML);

        let challengeCode = homepageData.match(/"ondemand.s":"(\w+)"/)[1];
        let challengeData = await _fetch(`https://abs.twimg.com/responsive-web/client-web/ondemand.s.${challengeCode}a.js`).then(res => res.text());

        function sendInit() {
            solverIframe.contentWindow.postMessage({
                action: 'init',
                code: challengeData,
                anims,
                verificationCode: OLDTWITTER_CONFIG.verificationKey
            }, '*');
        }
        if(solverIframe.contentWindow) {
            sendInit();
        } else {
            solverIframe.addEventListener('load', () => sendInit());
        }
    } catch (e) {
        console.error(`Error during challenge:`);
        console.error(e);
    }
})()