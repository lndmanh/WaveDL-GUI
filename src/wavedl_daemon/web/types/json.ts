export type Json = null | boolean | number | string | Json[] | JsonObject;

export type JsonObject = { [key: string]: Json };
