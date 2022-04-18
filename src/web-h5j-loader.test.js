import fs from 'fs';
import path from 'path';
import { openH5J, getH5JAttrs, readH5JChannelUint8, readH5JChannelUint16 } from './web-h5j-loader';

// Data citation: https://dx.doi.org/10.1016/j.celrep.2012.09.011
function getMockData(dataFileName = 'R10E08-20191011_61_I8-m-40x-central-GAL4-JRC2018_Unisex_20x_HR-aligned_stack.h5j') {
    const dataFilePath = path.resolve(__dirname, '..', 'testData', dataFileName);
    const data = fs.readFileSync(dataFilePath);
    const dataArrayBuffer = new Uint8Array(data).buffer;
    return dataArrayBuffer;
}

describe('web-h5j-loader test suite', () => {
    // Note that the testing function is marked `async`, to allow use of `await`.
    it('loads H5J data from a URL', async () => {
        expect.hasAssertions();

        // Read the data to be returned by the mock `fetch`.
        const dataArrayBuffer = getMockData();

        // Set up the mock `fetch` to return `dataArrayBuffer`.
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                arrayBuffer: () => dataArrayBuffer,
            })
        );

        // Note that the actual URL is irrelevant with the mock `fetch`.
        const fileH5J = await openH5J('http://good.org/good');

        expect(fileH5J).toBeDefined();

        const attrs = getH5JAttrs(fileH5J);

        expect(Object.prototype.hasOwnProperty.call(attrs, 'image_size')).toBe(true);
        expect(attrs.image_size).toStrictEqual([1210, 566, 174]);
        expect(Object.prototype.hasOwnProperty.call(attrs, 'channels')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(attrs.channels, 'names')).toBe(true);
        expect(attrs.channels.names).toHaveLength(4);

        const dataUint8 = await readH5JChannelUint8(attrs.channels.names[0], fileH5J);

        expect(dataUint8).not.toBeNull();
        // Alignment padding may make the actual size greater than what `image_size` would specify.
        const len = dataUint8.length;
        expect(len).toBeGreaterThanOrEqual(attrs.image_size[0] * attrs.image_size[1] * attrs.image_size[2]);
    });

    it('throws an exception for a URL producing an non-200 response', async () => {
        expect.hasAssertions();

        // Set up the mock `fetch` to return an error status.
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                status: 404,
                arrayBuffer: () => null,
            })
        );

        // The following is how Jest can detect that an `async` function threw an exception, per: 
        // https://jestjs.io/docs/expect#rejects
        await expect(openH5J('https://bad.org/bad')).rejects.toThrow('openH5J failed');
    });

    it('throws an exception for a URL producing an non-ok response', async () => {
        expect.hasAssertions();

        // Set up the mock `fetch` to return false for `ok`.
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: false,
                status: 200,
                arrayBuffer: () => null,
            })
        );

        // The following is how Jest can detect that an `async` function threw an exception, per: 
        // https://jestjs.io/docs/expect#rejects
        await expect(openH5J('https://bad.org/bad')).rejects.toThrow('openH5J failed');
    });

    it('loads H5J data from a File', async () => {
        expect.hasAssertions();

        // Read the data to be returned by the mock `fetch`.
        const dataArrayBuffer = getMockData();

        class File {
            constructor() {
                this.name = '';
                this.type = '';
            }
        };
        global.File = File;

        class FileReader {
            constructor() {
                this.onload = () => {};
                this.onerror = () => {};
                this.readAsArrayBuffer = () => this.onload();
                this.result = dataArrayBuffer;
            }
        };
        global.FileReader = FileReader;

        const file = new global.File();
        const fileH5J = await openH5J(file);

        expect(fileH5J).toBeDefined();

        const attrs = getH5JAttrs(fileH5J);

        expect(Object.prototype.hasOwnProperty.call(attrs, 'image_size')).toBe(true);
        expect(attrs.image_size).toStrictEqual([1210, 566, 174]);
        expect(Object.prototype.hasOwnProperty.call(attrs, 'channels')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(attrs.channels, 'names')).toBe(true);
        expect(attrs.channels.names).toHaveLength(4);
    });

    it('throws an exception for a File that is not an HDF5 container', async () => {
        expect.hasAssertions();

        class File {
            constructor() {
                this.name = '';
                this.type = '';
            }
        };
        global.File = File;

        class FileReader {
            constructor() {
                this.onload = () => {};
                this.onerror = () => {};
                this.readAsArrayBuffer = () => this.onload();
            }
        };
        global.FileReader = FileReader;

        const file = new global.File();
        await expect(openH5J(file)).rejects.toThrow('openH5J failed');
    });

    it('decompresses to a Uint8Array with acceptable accuracy', async () => {
        expect.hasAssertions();

        // Read the data to be returned by the mock `FileReader`.  The data consists of 2^12 (4096) slices,
        // with slice `i` having only data value `i` (originally a `Uint16` then compressed to 12-bits).
        const dataFileName = 'h64w64d4096_uint16_0-4095.h5j'
        const dataArrayBuffer = getMockData(dataFileName);

        class File {
            constructor() {
                this.name = '';
                this.type = '';
            }
        };
        global.File = File;

        class FileReader {
            constructor() {
                this.onload = () => {};
                this.onerror = () => {};
                this.readAsArrayBuffer = () => this.onload();
                this.result = dataArrayBuffer;
            }
        };
        global.FileReader = FileReader;

        const file = new global.File();
        const fileH5J = await openH5J(file);

        expect(fileH5J).toBeDefined();

        const attrs = getH5JAttrs(fileH5J);

        expect(Object.prototype.hasOwnProperty.call(attrs, 'image_size')).toBe(true);
        expect(attrs.image_size).toStrictEqual([64, 64, 4096]);
        expect(Object.prototype.hasOwnProperty.call(attrs, 'channels')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(attrs.channels, 'names')).toBe(true);
        expect(attrs.channels.names).toHaveLength(1);

        const dataUint8 = await readH5JChannelUint8(attrs.channels.names[0], fileH5J);

        expect(dataUint8).not.toBeNull();
        // Alignment padding may make the actual size greater than what `image_size` would specify.
        const len = dataUint8.length;
        expect(len).toBeGreaterThanOrEqual(attrs.image_size[0] * attrs.image_size[1] * attrs.image_size[2]);

        // A slice is an X-Y image with a constant Z.
        const elementsPerSlice = attrs.image_size[0] * attrs.image_size[1];

        // The number of slices (each with one of the orginal 12-bit file values) that map to
        // a single 8-bit in-memory value.
        const slicesPerUint8Value = 2 ** 12 / 2 ** 8;

        let sliceElementCounts = {};
        dataUint8.forEach((element, index) => {
            const indexOfSlice = Math.floor(index / elementsPerSlice);
            const indexInSlice = index - indexOfSlice * elementsPerSlice;

            // Count each distinct element value in the slice, to find the mode (value occurring most often).
            if (indexInSlice === 0) {
                sliceElementCounts = {};
            }
            if (!(element in sliceElementCounts)) {
                sliceElementCounts[element] = 0;
            }
            sliceElementCounts[element] += 1;

            if (indexInSlice === elementsPerSlice - 1) {
                // The rounded value is expected.
                const expectedUint8Value = Math.floor(indexOfSlice / 16 + 0.5);

                // The values in the slice should be very close to the expected 8-bit value.
                Object.keys(sliceElementCounts).forEach((sliceElement) => {
                    const diff = sliceElement - expectedUint8Value;
                    expect(diff).toBeGreaterThanOrEqual(-1);
                    expect(diff).toBeLessThanOrEqual(1);
                });

                // The mode is the most frequently occurring value in the slice.
                const mode = Object.entries(sliceElementCounts).reduce((a, c) => c[1] > a[1] ? c : a, [0, 0])[0];
                const diff = mode - expectedUint8Value;
                const rem = indexOfSlice % slicesPerUint8Value;

                // In practice, the mode is the expected value for most slices except right around
                // where the rounding makes the expected value change....
                if (rem === slicesPerUint8Value / 2) {
                    expect(diff).toBe(-1);
                } else if (rem === slicesPerUint8Value / 2 + 1) {
                    expect(diff).toBeGreaterThanOrEqual(-1);
                    expect(diff).toBeLessThanOrEqual(0);
                } else if (expectedUint8Value > 255) {
                    // ...and also for slices where the expected value is the maximum.
                    expect(diff).toBe(-1);
                } else {
                    expect(diff).toBe(0);
                }
            }
        });
    });

    it('decompresses to a Uint16Array with acceptable accuracy', async () => {
        expect.hasAssertions();

        // Read the data to be returned by the mock `FileReader`.  The data consists of 2^12 (4096) slices,
        // with slice `i` having only data value `i` (originally a `Uint16` then compressed to 12-bits).
        const dataFileName = 'h64w64d4096_uint16_0-4095.h5j'
        const dataArrayBuffer = getMockData(dataFileName);

        class File {
            constructor() {
                this.name = '';
                this.type = '';
            }
        };
        global.File = File;

        class FileReader {
            constructor() {
                this.onload = () => {};
                this.onerror = () => {};
                this.readAsArrayBuffer = () => this.onload();
                this.result = dataArrayBuffer;
            }
        };
        global.FileReader = FileReader;

        const file = new global.File();
        const fileH5J = await openH5J(file);

        expect(fileH5J).toBeDefined();

        const attrs = getH5JAttrs(fileH5J);

        expect(Object.prototype.hasOwnProperty.call(attrs, 'image_size')).toBe(true);
        expect(attrs.image_size).toStrictEqual([64, 64, 4096]);
        expect(Object.prototype.hasOwnProperty.call(attrs, 'channels')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(attrs.channels, 'names')).toBe(true);
        expect(attrs.channels.names).toHaveLength(1);

        const dataUint16 = await readH5JChannelUint16(attrs.channels.names[0], fileH5J);

        expect(dataUint16).not.toBeNull();
        // Alignment padding may make the actual size greater than what `image_size` would specify.
        const len = dataUint16.length;
        expect(len).toBeGreaterThanOrEqual(attrs.image_size[0] * attrs.image_size[1] * attrs.image_size[2]);

        // A slice is an X-Y image with a constant Z.
        const elementsPerSlice = attrs.image_size[0] * attrs.image_size[1];

        let expectedUint16Value = 0;
        let sliceElementCounts = {};
        dataUint16.forEach((element, index) => {
            const indexOfSlice = Math.floor(index / elementsPerSlice);
            const indexInSlice = index - indexOfSlice * elementsPerSlice;

            // Count each distinct element value in the slice, to find the mode (value occurring most often).
            if (indexInSlice === 0) {
                sliceElementCounts = {};
            }
            if (!(element in sliceElementCounts)) {
                sliceElementCounts[element] = 0;
            }
            sliceElementCounts[element] += 1;

            if (indexInSlice === elementsPerSlice - 1) {
                // The values in the slice should be very close to the expected 16-bit value.
                Object.keys(sliceElementCounts).forEach((sliceElement) => {
                    const diff = sliceElement - expectedUint16Value;
                    expect(diff).toBeGreaterThanOrEqual(-3);
                    expect(diff).toBeLessThanOrEqual(2);
                });
                
                // The mode (most common value) should be even closer.
                const mode = Object.entries(sliceElementCounts).reduce((a, c) => c[1] > a[1] ? c : a, [0, 0])[0];
                const diff = mode - expectedUint16Value;
                expect(diff).toBeGreaterThanOrEqual(-1);
                expect(diff).toBeLessThanOrEqual(1);

                expectedUint16Value += 1;
            }
        });
    });
})
