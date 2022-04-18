// Functions to load data from files in H5J format:
// https://github.com/JaneliaSciComp/workstation/blob/master/docs/H5JFileFormat.md
// A H5J file is an HDF5 container with one or more channels of data compressed with 
// H.265 (a.k.a. HEVC or High Efficiency Video Coding).

// The HDF5 container is read with the jsfive module:
// https://www.npmjs.com/package/jsfive
// The H.265 data is decoded with the ffmpeg.wasm module, which uses WebAssembly (wasm):
// https://github.com/ffmpegwasm/ffmpeg.wasm
// The ffmpeg.wasm module was built using Emscripten, to transpile the original FFMpeg
// C++ code into WebAssembly.

// Example usage:
// import { openH5J, getH5JAttrs, readH5JChannelUint8 } from 'web-h5j-loader';
// try {
//   const fileH5J = await openH5J('http://example.org/example.h5j');
//   const attrs = getH5JAttrs(fileH5J);
//   const dataUint8 = await readH5JChannelUint8(attrs.channels.names[0], fileH5J);
// } catch (e) {}

// See the comments at `readH5JChannelUint8` for a tip on improving performance when
// reading multiple files.

import * as hdf5 from 'jsfive/dist'; 
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg';

// The `src` can be either a `File` or a string specifying a URL.
export async function openH5J(src) {
  const errPrefix = "openH5J failed:";

  // Treat a string argument as a URL and use `fetch` to return a promise that 
  // resolves to the H5J file.
  if (typeof src === 'string') {
    return (fetch(src)
      .then((response) => {
        if (response.ok) {
          if (response.status === 200) {
            return response.arrayBuffer();
          }
          throw new Error(`${errPrefix} response.status ${response.status}, "${response.statusText}"`);
        }
        throw new Error(`${errPrefix} response.ok false`);
      })
      .then((buffer) => {
        const fileHdf5 = new hdf5.File(buffer);
        return fileHdf5;
      })
    )
  }

  // If the argument is a reference to a local H5J file, read it with `FileReader`
  // but rephrase the reading with promises to match the pattern of `fetch`.
  if (src instanceof global.File) {
    return (new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const fileHdf5 = new hdf5.File(reader.result, src.name);
          resolve(fileHdf5);
        } catch (exc) {
          reject(new Error(`${errPrefix} ${exc}`));
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(src);
    }));
  }

  return Promise.reject(new Error(`${errPrefix} unknown "src" type`));
}

export function getH5JAttrs(fileH5J) {
  if (!fileH5J) {
    return null;
  }

  const { attrs } = fileH5J;
  const result = { ...attrs };

  const channelsGroup = fileH5J.get('Channels');
  if (channelsGroup) {
    const channels = { ...channelsGroup.attrs };

    channels.names = channelsGroup.keys.map((channelName) => channelName);
    channels.content_types = channelsGroup.keys.map((channelName) => (
      channelsGroup.get(channelName).attrs.content_type
    ));

    result.channels = channels;
  }

  return result;
}

export const createFFmpegForEnv = async () => {
  const t0 = performance.now();

  let ff;
  if (process.env.NODE_ENV === 'development') {
    ff = createFFmpeg({
      // The `corePath` is necessary because otherwise, the `create-react-app`
      // dev server does not serve some "core" ffmpeg.wasm files correctly:
      // https://github.com/ffmpegwasm/ffmpeg.wasm#why-it-doesnt-work-in-my-local-environment
      // "When calling ffmpeg.load(), by default it looks for 
      // http://localhost:3000/node_modules/@ffmpeg/core/dist/ 
      // to download essential files (ffmpeg-core.js, ffmpeg-core.wasm, ffmpeg-core.worker.js). 
      // It is necessary to make sure you have those files served there.
      // Use the public address [i.e., unpkg.com] if you don't want to host your own."
      // The problem may have been introduced between ffmpeg.wasm v0.10.0 and v0.10.1:
      // https://github.com/ffmpegwasm/ffmpeg.wasm/issues/199#issuecomment-871165126
      // Note that the `core@` version number must match what is in `package.json`.
      corePath: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      log: true 
    });
  } else {
    ff = createFFmpeg({ log: true });
  }
  await ff.load();

  const t1 = performance.now();
  console.log(`Initializing ffmpeg.wasm took ${Math.round(t1 - t0)} ms`);
  
  return ff;
}

async function readH5JChannel(channelName, fileH5J, onProgress0, ffmpeg0, pixFmt) {
  if (!fileH5J) {
    return null;
  }
  
  let ffmpeg = ffmpeg0;
  if (!ffmpeg) {
    ffmpeg = await createFFmpegForEnv();
  }

  let onProgress = onProgress0;
  if (!onProgress) {
    onProgress = ({ ratio }) => { console.log(`Loaded ${ratio * 100}%`)};
  }
  ffmpeg.setProgress(onProgress);

  let channelH5J;
  try {
    channelH5J = fileH5J.get(`Channels/${channelName}`);
  } catch (exc) {
    console.log(`Cannot get H5J channel ${channelName}: '${exc}'`);
    return null;
  }

  try {
    const inputFileName = `${fileH5J.filename}_${channelName}`;
    const outputFileName = `${inputFileName}.raw`;

    // Use the ffmpeg.wasm commands to fetch the data from the channel of the HDF5 container
    // and write it to a "file" with a name from  `inputFileName` on the internal "file system" (as
    // implemented by Emscripten: https://emscripten.org/docs/porting/files/file_systems_overview.html)
    ffmpeg.FS('writeFile', inputFileName, await fetchFile(channelH5J.value));

    // Use ffmpeg.wasm to run the equivlent of the following FFMpeg command at the command line:
    // $ ffmpeg -i <inputFileName> -c:v rawvideo -pix_fmt gray -f rawvideo <outputFileName>
    // The input format (i.e., H.265) is automatically detected by the FFMpeg code, and the
    // explicit arguments have the following meaning:
    // -i <inputFileName> : the input file name is <inputFileName>
    // -c:v rawvideo : use the `rawvideo` codec for output
    // -pix_fmt gray (or -pix_fmt gray12le) : use 8-bit (or 12-bit) grayscale pixels for the output
    // -f rawvideo : force the output format to be `rawvideo`
    // The output file name has the `.raw` suffix.
    await ffmpeg.run('-i', inputFileName, '-c:v', 'rawvideo', '-pix_fmt', pixFmt, '-f', 'rawvideo', outputFileName);

    // Use a ffmpeg.wasm command to read the data from the "file" named `volume.raw` and return it
    // as a JavaScript `Uint8Array` typed array ("array-like objects that provide a mechanism for
    // reading and writing raw binary data in memory buffers").
    const data = ffmpeg.FS('readFile', outputFileName);
    return data;
  } catch (exc) {
    console.log(`Cannot use ffmpeg.wasm to decode channel ${channelName}: '${exc}'`);
    return null;
  }
}

// Returns a new `Uint8Array` with the H5J data from the specified channel.  Several of the
// original 12-bit data values will be mapped to each 8-bit result value.  For original data
// value `d`, the result value is roughly the rounded value `Math.floor(d/16 + 0.5)`, but
// there are slight variations: see the accuracy test in `web-h5j-loader.test.js` for details.
// The `ffmpeg0` argument can be omitted, and initialization of ffmpeg.wasm will
// happen automatically.  But it will be done with again for each file to be read.
// To improve performance, explicitly call `await createFFmpegForEnv()` once and
// pass the result as the `ffmpeg0` argument with each file to be read.
// TODO: Support a channel index argument as an alternative to `channelName`.
export async function readH5JChannelUint8(channelName, fileH5J, onProgress0, ffmpeg0) {
  return readH5JChannel(channelName, fileH5J, onProgress0, ffmpeg0, 'gray');
}

// Returns a new `Uint16Array` with the H5J data from the specified channel.  The data values
// will be roughly the original 12-bit values (i.e., they will NOT be scaled, so  an original
// value of 2^12 - 1 will NOT become 2^16 - 1) but there are slight variations: see the accuracy
// test in `web-h5j-loader.test.js` for details.
// See the comment on `readH5JChannelUint8` discussing the `ffmpeg0` argument.
export async function readH5JChannelUint16(channelName, fileH5J, onProgress0, ffmpeg0) {
  const dataUint8 = await readH5JChannel(channelName, fileH5J, onProgress0, ffmpeg0, 'gray12le');
  const dataUint16 = new Uint16Array(dataUint8.buffer);
  return dataUint16;
}
