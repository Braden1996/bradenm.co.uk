declare module '*.css' {
  const cssModule: {[className: string]: string};
  export = cssModule;
}
