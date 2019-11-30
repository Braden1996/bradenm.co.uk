import { transparentize, math } from 'polished';

import styled, { css } from '@styled';

interface TagProps {
  readonly kind?: number;
}

const Tag = styled.span<TagProps>`
  ${p => css`
    font-size: ${p.theme.typography.scale(-0.4).fontSize};
    line-height: ${p.theme.typography.scale(-0.4).fontSize};
  `}
  margin-bottom: 0;
  padding: ${p => math(`0.125 * ${p.theme.dimensions.use.margin}`)} ${p => math(`0.25 * ${p.theme.dimensions.use.margin}`)};
  border-radius: ${p => p.theme.dimensions.use.borderRadius.normal};
  color: ${p => p.theme.colors.use.text.tertiary};
  text-transform: uppercase;

  ${p => {
    let kindColor;
    switch (p.kind) {
      case 0:
        kindColor = p.theme.colors.base.nord10;
        break;
      case 1:
        kindColor = p.theme.colors.base.nord13;
        break;
      case 2:
        kindColor = p.theme.colors.base.nord14;
        break;
      default:
        kindColor = p.theme.colors.base.nord15;
        break;
    }

    return css`
      background-color: ${transparentize(0.5, kindColor)};
      border: 1px solid ${kindColor};
    `;
  }}
`;

export default Tag;
