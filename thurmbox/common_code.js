// Configuration --------------------------------------------------------------

// The prefix should end with a slash ("/").
// var DEFAULT_SAMPLE_URL_PREFIX = "./samples/";
var DEFAULT_SAMPLE_URL_PREFIX = "https://file.garden/ZMQ0Om5nmTe-x2hq/PandoraArchive%20Samples/";

// The suffix is normally ".wav", or ".txt", or even, empty ("").
// var DEFAULT_SAMPLE_URL_SUFFIX = ".txt";
var DEFAULT_SAMPLE_URL_SUFFIX = ".wav";

// Recognized format strings:
// - "txt"
// - "wav"
// Anything else is assumed to be supported by Web Audio, which it may not be.
//
// Why define the format separately? Because you might have samples that have
// no extension, so simple format detection based on that won't work.
// var DEFAULT_SAMPLE_FORMAT = "txt";
var DEFAULT_SAMPLE_FORMAT = "wav";

var DEFAULT_FOLDER_MAPPINGS = new Map([
    // The syntax is: ["folder name/", /^[a-f]/i],
    // The second element is a regular expression. The sample name is tested
    // against it, and the first folder that matches will be used.
    // The i flag is important, to make it case-insensitive.
    ["0-9%20and%20A/", /^[0-9a]/i],
    ["B/", /^[b]/i],
    ["CD/", /^[cd]/i],
    ["EF/", /^[ef]/i],
    ["GH/", /^[gh]/i],
    ["IJKL/", /^[ijkl]/i],
    ["M/", /^[m]/i],
    ["NO/", /^[no]/i],
    ["P/", /^[p]/i],
    ["QR/", /^[qr]/i],
    ["S/", /^[s]/i],
    ["TUV/", /^[tuv]/i],
    ["WXYZ/", /^[wxyz]/i],
]);

// Any mappings are defined here are used over the prefix+name+suffix scheme.
var SAMPLE_URL_TABLE = new Map([
    // The syntax is: ["name", ["url", "format"]],
    // The format string is the same as the one for "DEFAULT_SAMPLE_FORMAT".
    // ["Hihat", ["https://example.com/file.wav", "wav"]],
]);

// Common code ----------------------------------------------------------------

// Some remarks:
//
// jQuery is configured so that its .ajax method is synchronous - presumably to
// not cause sample loading issues. Problem is that, some browser APIs force
// asynchrony on you anyway, so we might as well get it working.
//
// So, this is approached in the same way as UB today (due to be replaced with
// something less hacky, but UB's "custom samples" feature is still mostly
// derived from PB/Thurmbox):
// - Sample data is set to start loading
// - Placeholder sample data is used in place of that, until loading is done,
//   at some unspecified point in the future
// - Once loaded, the sample data is put in the right place in Config,
//   overwriting the placeholder reference
//
// All sample parsers are asynchronous, resolving a Promise when done, even if
// only decodeAudioData is the only one that actually works that way.
//
// Since Web Audio's decodeAudioData can be used here, this can make use of all
// the formats supported by that, with caveats such as less-than-perfect
// cross-browser support, of course.
//
// The "sample URL table" is there to support explicit name -> URL mappings, if
// that's ever deemed necessary. If defined, it takes priority over the default
// mapping.
//
// The default mapping expects a consistent prefix, suffix, and format defined,
// from which it will derive the sample URL by adding the name onto that.
// It also supports folders, optionally. A regular expression is used to
// determine whether to use a folder for a given name.
//
// If the URL table gets too large, it can be moved to another script for the
// sake of making editing less painful.

function getSampleDefinitionFromName(name) {
    let url;
    let format;

    const tableEntry = SAMPLE_URL_TABLE.get(name);
    if (tableEntry != null) {
        url = tableEntry[0];
        format = tableEntry[1];
    }

    if (url == null) {
        // Sample names should only be alphanumeric with no symbols, but I
        // might as well encode these since they're part of filenames, instead
        // of the URL metacharacters.
        const percentEncodedName = encodeURIComponent(name);

        let folderName = "";
        for (const [possibleFolderName, nameMatcher] of DEFAULT_FOLDER_MAPPINGS.entries()) {
            if (name.match(nameMatcher)) {
                folderName = possibleFolderName;
                break;
            }
        }

        url = DEFAULT_SAMPLE_URL_PREFIX + folderName + percentEncodedName + DEFAULT_SAMPLE_URL_SUFFIX;
        format = DEFAULT_SAMPLE_FORMAT;
    }

    return { url: url, format: format };
}

function makeArrayOfSameType(a, length) {
    if (length == null) length = a.length;

    // Add more cases as necessary.
    if (a instanceof Float32Array) return new Float32Array(length);
    if (a instanceof Float64Array) return new Float64Array(length);

    // @TODO: Should this push `length` zeros? Allocating an array with holes
    // is probably going to slow things down, but I'm less sure about assigning
    // in order.
    return [];
}

// These are the same as centerWave/performIntegral, I've picked different
// names to not have collisions. Also, these don't allocate arrays by
// themselves, that's left up to the caller.
function computeCenteredWave(wave, result) {
    let sum = 0.0;
    for (let i = 0; i < wave.length; i++) {
        sum += wave[i];
    }
    const average = sum / wave.length;
    for (let i = 0; i < wave.length; i++) {
        result[i] = wave[i] - average;
    }
    return result;
}
function computeIntegral(wave, result) {
    let cumulative = 0.0;
    for (let i = 0; i < wave.length; i++) {
        const temp = wave[i];
        result[i] = cumulative;
        cumulative += temp;
    }
    return result;
}

function startLoadingSampleData(name, chipWaveRaw, chipWaveIntegral) {
    const sampleDefinition = getSampleDefinitionFromName(name);
    const url = sampleDefinition.url;
    const format = sampleDefinition.format;

    // chipWaveIntegral and chipWaveRaw should be the objects in
    // Config.chipWaves and Config.rawChipWaves.

    fetch(url).then((response) => {
        if (!response.ok) {
            return Promise.reject(new Error(`Couldn't load sample ${name} at ${url}`));
        }
        switch (format) {
            case "txt": return response.text();
            default: return response.arrayBuffer();
        }
    }).then((arrayBuffer) => {
        switch (format) {
            case "txt": return parseTextSample(arrayBuffer);
            default: return parseSampleWithWebAudio(arrayBuffer);
        }
    })
    .then((parsed) => {
        // @TODO: These may or may not need an extra zero sample at the end.
        if (chipWaveRaw != null) {
            chipWaveRaw.samples = parsed;
        }
        if (chipWaveIntegral != null) {
            const integralData = computeIntegral(parsed, makeArrayOfSameType(parsed));
            chipWaveIntegral.samples = integralData;
        }
    }).catch((error) => {
        console.error(error);
    });
}

function parseTextSample(data) {
    return new Promise((resolve, reject) => {
        // This is the format stored in the .txt files, supposed to be similar
        // to the data exported via Audacity and cleaned up for PB, I guess.

        // This assumes that there are no blank lines, and no other whitespace
        // other than the \n to terminate every line.
        const lines = data.split("\n");
        const waveLength = lines.length;
        const parsed = new Float32Array(waveLength);
        for (let i = 0; i < waveLength; i++) {
            parsed[i] = +lines[i];
        }
        resolve(computeCenteredWave(parsed, makeArrayOfSameType(parsed, parsed.length + 1)));
    });
}

function parseSampleWithWebAudio(data) {
    // Change this if you need to, but this is what's in use by the Thurmbox
    // samples.
    // Samples will be resampled to this rate when decoded. Normally this
    // changes the sample a bit, adding some quick fade out at the end. If the
    // AudioContext sample rate and the sample rate of the file are the same,
    // then this should have no effect, in theory anyway.
    const sampleRate = 8000;

    const sampleLoaderAudioContext = new AudioContext({ sampleRate: sampleRate });
    let closedSampleLoaderAudioContext = false;

    return sampleLoaderAudioContext.decodeAudioData(data).then((audioBuffer) => {
        // @TODO: Downmix?
        const leftChannelSamples = audioBuffer.getChannelData(0);

        const rawSamples = computeCenteredWave(leftChannelSamples, makeArrayOfSameType(leftChannelSamples, leftChannelSamples.length + 1));

        if (!closedSampleLoaderAudioContext) {
            closedSampleLoaderAudioContext = true;
            sampleLoaderAudioContext.close();
        }

        return rawSamples;
    }).catch((error) => {
        if (!closedSampleLoaderAudioContext) {
            closedSampleLoaderAudioContext = true;
            sampleLoaderAudioContext.close();
        }
    });
}

