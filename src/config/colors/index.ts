import { transparentize } from 'polished';

// Colors named according to: http://chir.ag/projects/name-that-color/
import palette from './palette.json';
import nord from './nord.json';
import social from './social.json';

const base = { ...nord, ...palette, ...social };

const use = {
  social,
  background: {
    primary: base.nord1,
    secondary: base.nord0,
    tertiary: base.charade,
  },
  accent: {
    danger: base.nord11,
    info: base.nord9,
    primary: base.nord15,
    secondary: base.nord10,
    success: base.nord14,
    warning: base.nord12,
  },
  text: {
    primary: base.nord6,
    secondary: transparentize(0.1, base.nord6),
    tertiary: transparentize(0.2, base.nord6),
  },
};

const colors = { base, use };

export default colors;
