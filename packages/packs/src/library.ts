import { loadLayer, type ServicePack } from 'integration-mock-core';
import { dataPaths } from './paths.js';

/** Where the shipped packs live — see {@link dataPaths} for the three layouts. */
export const libraryPacksDir = (): string => dataPaths().packsDir;

/** The `library` layer of the resolver — generated packs shipped with the package. */
export const loadLibraryLayer = (): Promise<ServicePack[]> => loadLayer(libraryPacksDir());
