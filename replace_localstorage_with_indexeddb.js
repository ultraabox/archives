// Beepbox and its mods use localStorage for storing user preferences. This
// means that, when hosting many versions of Beepbox under the same
// domain (origin) as is done here, they will stomp over each other's data.
//
// One possible solution, implemented here, is to replace localStorage with
// something else.
//
// In this script, we replace localStorage with IndexedDB.
//
// Usage ----------------------------------------------------------------------
//
// <script src="../replace_localstorage_with_indexeddb.js"></script>
// <script>
//     document.addEventListener("DOMContentLoaded", () => {
//         // Use a different name per mod.
//         const databaseName = "beepboxFakeLocalStorage";
//         initializeFakeLocalStorage(databaseName).then(() => {
//             const scriptsToRun = document.querySelectorAll("script[type='text/plain']");
//             for (const scriptToRun of scriptsToRun) {
//                 const code = scriptToRun.textContent;
//                 const scriptElement = document.createElement("script");
//                 scriptElement.setAttribute("type", "text/javascript");
//                 scriptElement.textContent = code;
//                 document.head.appendChild(scriptElement);
//             }
//         });
//     });
// </script>
// <!-- <script type="text/javascript"> -->
// <script type="text/plain">
//     // mod code
// </script>

(function () {
	const localStorage = window.localStorage;
	const indexedDB = window.indexedDB;
	const location = window.location;

	function convertToString(value) {
		return value + "";
	}

	const onlyInMemory = false;

	class FakeLocalStorage {
		constructor(databaseName) {
			this._databaseName = databaseName;
			// @TODO: Make this configurable? Not really needed currently...
			this._storeName = "fakeLocalStorage";

			this._inMemoryData = new Map();
			this._database = null;
		}

		// localStorage API.

		getItem(key) {
			return this._getItemInMemory(key);
		}

		setItem(key, value) {
			this._setItemInMemory(key, value);
			this._setItemAsync(key, value);
		}

		removeItem(key) {
			this._removeItemInMemory(key);
			this._removeItemAsync(key);
		}

		clear() {
			this._clearInMemory();
			this._clearAsync();
		}

		// Internal API.

		_getItemInMemory(key) {
			key = convertToString(key);
			// localStorage.getItem returns null, not undefined, when the item
			// isn't present, so let's paper over that.
			let result = null;
			if (this._inMemoryData.has(key)) {
				result = this._inMemoryData.get(key);
			}
			return result;
		}

		_setItemInMemory(key, value) {
			key = convertToString(key);
			value = convertToString(value);
			return this._inMemoryData.set(key, value);
		}

		_removeItemInMemory(key) {
			key = convertToString(key);
			return this._inMemoryData.delete(key);
		}

		_clearInMemory() {
			this._inMemoryData.clear();
		}

		_initialize() {
			// @TODO: Review IndexedDB usage, compare with existing libraries
			// for pitfalls.
			return new Promise((resolve, reject) => {
				if (onlyInMemory) {
					console.log("Storing data in memory only.");
					resolve();
				} else {
					const request = indexedDB.open(this._databaseName, 1);
					request.onerror = (event) => {
						console.error("Couldn't open IndexedDB database, storing data in memory only.");
						resolve();
					};
					request.onsuccess = (event) => {
						this._database = event.target.result;
						this._loadAllPreviouslyStoredData().then(() => {
							resolve();
						});
					};
					request.onupgradeneeded = (event) => {
						const database = event.target.result;
						database.createObjectStore(this._storeName);
					};
				}
			});
		}

		_loadAllPreviouslyStoredData() {
			return new Promise((resolve, reject) => {
				const transaction = this._database.transaction([this._storeName], "readonly");
				const store = transaction.objectStore(this._storeName);
				const request = store.openCursor();
				request.onsuccess = (event) => {
					const cursor = event.target.result;
					if (cursor) {
						this._setItemInMemory(cursor.key, cursor.value);
						cursor.continue();
					} else {
						resolve();
					}
				};
				request.onerror = (event) => {
					console.error("Couldn't load data previously stored in IndexedDB database.");
					resolve();
				};
			});
		}

		_getItemAsync(key) {
			if (this._database == null) {
				// Return undefined and fail silently, since we can't
				// read/write to the database.
				return;
			}

			key = convertToString(key);

			return new Promise((resolve, reject) => {
				const transaction = this._database.transaction([this._storeName], "readonly");
				const store = transaction.objectStore(this._storeName);
				const request = store.get(key);
				request.onsuccess = (event) => {
					resolve(event.target.result);
				};
				request.onerror = (event) => {
					console.error(`Couldn't get value for the ${key} key in IndexedDB.`);
					resolve();
				};
			});
		}

		_setItemAsync(key, value) {
			if (this._database == null) {
				// Return undefined and fail silently, since we can't
				// read/write to the database.
				return;
			}

			key = convertToString(key);
			value = convertToString(value);

			return new Promise((resolve, reject) => {
				const transaction = this._database.transaction([this._storeName], "readwrite");
				const store = transaction.objectStore(this._storeName);
				const request = store.put(value, key);
				request.onsuccess = (event) => {
					resolve();
				};
				request.onerror = (event) => {
					console.error(`Couldn't set value for the ${key} key in IndexedDB.`);
					resolve();
				};
			});
		}

		_removeItemAsync(key) {
			if (this._database == null) {
				// Return undefined and fail silently, since we can't
				// read/write to the database.
				return;
			}

			key = convertToString(key);

			return new Promise((resolve, reject) => {
				const transaction = this._database.transaction([this._storeName], "readwrite");
				const store = transaction.objectStore(this._storeName);
				const request = store.delete(key);
				request.onsuccess = (event) => {
					resolve();
				};
				request.onerror = (event) => {
					console.error(`Couldn't remove value for the ${key} key in IndexedDB.`);
					resolve();
				};
			});
		}

		_clearAsync() {
			if (this._database == null) {
				// Return undefined and fail silently, since we can't
				// read/write to the database.
				return;
			}

			return new Promise((resolve, reject) => {
				const transaction = this._database.transaction([this._storeName], "readwrite");
				const store = transaction.objectStore(this._storeName);
				const request = store.clear();
				request.onsuccess = (event) => {
					resolve();
				};
				request.onerror = (event) => {
					console.error(`Couldn't clear IndexedDB store.`);
					resolve();
				};
			});
		}
	}

	// Use this in a mod to replace localStorage. The promise this returns will
	// be resolved when it's ready for use - everything is asynchronous with
	// IndexedDB, so if synchronous access is important, mod initialization has
	// to be delayed until this is ready.
	function initializeFakeLocalStorage(databaseName) {
		return new Promise((resolve, reject) => {
			// @TODO: Set up a Proxy to intercept property access? Is that used
			// in any mod?
			const fakeLocalStorage = new FakeLocalStorage(databaseName);
			fakeLocalStorage._initialize().then(() => {
				Object.defineProperty(window, "localStorage", {
					value: fakeLocalStorage,
				});
				resolve();
			});
		});
	}

	window.initializeFakeLocalStorage = initializeFakeLocalStorage;
})();
