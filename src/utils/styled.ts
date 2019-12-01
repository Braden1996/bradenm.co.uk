import * as styledComponents from 'styled-components';
import { generateMedia } from 'styled-media-query';

import config from '@config';

const { site, ...themeConfig } = config;
export const theme = themeConfig;

const {
  default: styled,
  css,
  createGlobalStyle,
  keyframes,
  ThemeProvider,
} = styledComponents as styledComponents.ThemedStyledComponentsModule<typeof theme>;

export const media = generateMedia(themeConfig.dimensions.use.breakpoints);

export { css, createGlobalStyle, keyframes, ThemeProvider };
export default styled;
