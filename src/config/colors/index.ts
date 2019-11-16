import Color from 'color';

// Colors named according to: http://chir.ag/projects/name-that-color/
import base from './palette.json';

const use = {
  background: {
    primary: base.white,
    secondary: base.whisper,
    tertiary: base.yellowOrange,
  },
  accent: {
    danger: base.radicalRed,
    info: base.azureRadiance,
    primary: base.dodgerBlue,
    secondary: base.electricViolet,
    success: base.caribbeanGreen,
    warning: base.webOrange,
  },
  text: {
    blackPrimary: new Color(base.black)
      .alpha(0.87)
      .toString(),
    blackSecondary: new Color(base.black)
      .alpha(0.54)
      .toString(),
    blackTertiary: new Color(base.black)
      .alpha(0.38)
      .toString(),
    whitePrimary: new Color(base.white).toString(),
    whiteSecondary: new Color(base.white)
      .alpha(0.7)
      .toString(),
    whiteTertiary: new Color(base.white)
      .alpha(0.5)
      .toString(),
  },
};

const colors = { base, use };

export default colors;
