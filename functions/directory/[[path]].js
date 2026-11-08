import {createDirectorySnapshot} from '../_shared/directory-snapshot.js';
const directory=createDirectorySnapshot();
export function onRequest(context){return directory(context);}
