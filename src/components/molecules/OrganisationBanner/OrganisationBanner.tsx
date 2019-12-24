import * as React from 'react';

import { DateRange } from '@atoms';
import styled, { media } from '@styled';

const ImageContainer = styled.span`
  display: flex;
  width: ${p => p.theme.dimensions.base.xLarge};
  height: ${p => p.theme.dimensions.base.xLarge};

  & > a {
    border-bottom: none;

    & > img {
      margin: 0;
      width: 100%;
      height: 100%; 
      object-fit: contain;
    }
  }
`;
const Name = styled.span``;
const Role = styled.span`
  font-variant-caps: small-caps;
  color: ${p => p.theme.colors.use.text.secondary};
`;
const Location = styled.span`
  color: ${p => p.theme.colors.use.accent.secondary};
`;
const StyledDateRange = styled(DateRange)``;

const Container = styled.section`
  display: grid;
  grid-template-columns: min-content 1fr;
  grid-column-gap: ${p => p.theme.dimensions.use.margin};
  grid-row-gap: ${p => p.theme.dimensions.base.xSmall};
  grid-template-rows: repeat(4, 1fr);

  & > ${ImageContainer}, & > ${Name}, & > ${Role}, & > ${Location}, & > ${StyledDateRange} {
    justify-self: flex-start;
    align-self: center;
  }

  & > ${ImageContainer} {
    grid-area: 1 / 1 / 5 / 1;
  }

  & > ${Name} {
    grid-area: 1 / 2;
  }

  & > ${Role} {
    grid-area: 2 / 2;
  }

  & > ${Location} {
    grid-area: 3 / 2;
  }

  & > ${StyledDateRange} {
    grid-area: 4 / 2;
  }

  ${media.greaterThan('mobile')`
    grid-template-columns: min-content repeat(2, 1fr);
    grid-template-rows: repeat(3, 1fr);

    & > ${Name} {
      grid-column-end: 4;
    }

    & > ${Role} {
      grid-column-end: 4;
    }

    & > ${Location} {
      grid-column-end: 3;
    }

    & > ${StyledDateRange} {
      grid-area: 3 / 2 / 3 / 4;
      justify-self: flex-end;
      align-self: flex-end;
    }
  `}

  ${media.greaterThan('tablet')`
    grid-template-rows: repeat(2, 1fr);

    & > ${ImageContainer} {
      grid-area: 1 / 1 / 3 / 1;
    }

    & > ${Name} {
      grid-area: 1 / 2;
    }

    & > ${Role} {
      align-self: flex-end;
    }

    & > ${Location} {
      grid-area: 1 / 3;
      justify-self: flex-end;
    }

    & > ${StyledDateRange} {
      grid-area: 2 / 3;
      justify-self: flex-end;
      align-self: flex-end;
    }
  `}
`;

interface Props {
  image: string;
  name: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  href: string;
}

const OrganisationBanner: React.FC<Props> = ({
  image,
  name,
  role,
  location,
  startDate,
  endDate,
  href,
}) => (
  <Container>
    <ImageContainer>
      <a href={href}>
        <img src={image} />
      </a>
    </ImageContainer>
    <Name><a href={href}>{name}</a></Name>
    <Role>{role}</Role>
    <Location>{location}</Location>
    <StyledDateRange startDate={startDate} endDate={endDate} />
  </Container>
);

export default OrganisationBanner;
