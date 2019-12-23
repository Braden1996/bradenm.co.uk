declare module '@mdx-js/react' {
  export interface MDXProviderProps {
    components: Record<string, React.Component<any, any> | React.FC<any>>;
  }
  export class MDXProvider extends React.Component<MDXProviderProps> {}
}
