import styled, { css } from '@styled';

interface Props {
  circle?: boolean;
}

const GatsbyImageEnhancer = styled.div<Props>`
  .gatsby-resp-image-wrapper {
    ${p => p.circle && css`
      overflow: hidden;
      border-radius: 50%
    `};
  }
`;

export default GatsbyImageEnhancer;
