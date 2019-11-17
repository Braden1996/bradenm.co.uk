import { CSSObject } from '@emotion/css';

const asCSSObjectTypes = <T>(et: { [Key in keyof T]: CSSObject }) => et;

const shadows = asCSSObjectTypes({
  light: {
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)',
  },
  medium: {
    boxShadow: '0 3px 6px rgba(0, 0, 0, 0.16), 0 3px 6px rgba(0, 0, 0, 0.23)',
  },
});

export default shadows;
