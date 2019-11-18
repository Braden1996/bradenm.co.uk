import * as styledComponents from 'styled-components';

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

export { css, createGlobalStyle, keyframes, ThemeProvider };
export default styled;
