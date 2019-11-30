import { graphql } from 'gatsby';
import { useStaticQuery } from 'gatsby';

import { Tag } from '@atoms';
import { AllTagsQuery } from '@gql-types';

type Tag = AllTagsQuery['allTagYaml']['edges'][0]['node'];
type TagColorMap = Record<Tag['id'], React.ComponentPropsWithoutRef<typeof Tag>['kind']>;

const useTagColorMap = () => {
  const allTags = useStaticQuery<AllTagsQuery>(graphql`
    query AllTags {
      allTagYaml {
        edges {
          node {
            id
            kind
          }
        }
      }
    }
  `);

  return allTags.allTagYaml.edges
    .reduce<TagColorMap>((a, { node }) => ({ ...a, [node.id]: node.kind! }), {});
};

export default useTagColorMap;
