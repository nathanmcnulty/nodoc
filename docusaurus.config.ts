import path from "node:path";
import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const siteTitle = "nodoc";
const siteTagline = "documenting undocumented interfaces";
const siteDescription =
  "OpenAPI specs and checked-in Postman collections for undocumented Microsoft portal APIs across Defender XDR, Exchange, Teams, Intune, M365 Admin, SharePoint, M365 Apps, Power Platform, Purview, Purview Portal, and Entra surfaces.";
const siteUrl = "https://nodoc.nathanmcnulty.com";
const aiBrowserEntry = path.resolve(process.cwd(), "node_modules", "ai", "dist", "index.js");

const config: Config = {
  title: siteTitle,
  tagline: siteTagline,
  titleDelimiter: "·",
  favicon: "img/favicon.svg",
  headTags: [
    {
      tagName: "script",
      attributes: {
        type: "application/ld+json",
      },
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: siteTitle,
        url: siteUrl,
        description: siteDescription,
      }),
    },
  ],

  // Set the production url of your site here
  url: siteUrl,
  baseUrl: "/",

  organizationName: "nathanmcnulty", // Usually your GitHub org/user name.
  projectName: "nodoc", // Usually your repo name.
  trailingSlash: false,

  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  plugins: [
    function aiWebpackAliasPlugin() {
      return {
        name: "ai-webpack-alias",
        configureWebpack() {
          return {
            resolve: {
              alias: {
                "ai$": aiBrowserEntry,
              },
            },
          };
        },
      };
    },
    [
      "./plugins/docusaurus-scalar", {
        withDefaultFonts: false,
        defaultOpenFirstTag: false,
        hideDarkModeToggle: true,
        hideTestRequestButton: true,
        layout: "modern",
        nav: {
          categoryFromPath: false
        },
        operationTitleSource: "summary",
        orderSchemaPropertiesBy: "preserve",
        route: {
          route: '/'
        },
        showDeveloperTools: "never",
        paths: [
          {
            path: "./specifications",
            include: ["**/openapi.{json,yml,yaml}"],
          }
        ]
      }
    ]
  ],

  presets: [
    [
      "classic",
      {
        docs: false,
        blog: false,
        sitemap: {
          changefreq: "weekly",
          priority: 0.7,
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    image: "img/nodoc-social-card.svg",
    metadata: [
      {
        name: "keywords",
        content:
          "undocumented APIs, Microsoft portal APIs, Defender XDR API, Exchange admin center API, Teams admin API, Teams API, Intune API, Windows Autopatch API, Microsoft 365 admin API, SharePoint API, SharePoint Online admin API, M365 Apps API, Power Platform API, Power Platform admin center API, Purview API, Entra API, OpenAPI, Postman",
      },
      {
        property: "og:type",
        content: "website",
      },
    ],
    colorMode: {
      respectPrefersColorScheme: true
    },
    navbar: {
      title: "nodoc",
      items: [
        {
          to: "/getting-started",
          label: "Getting Started",
          position: "left",
        },
        {
          href: "https://www.postman.com/dolphinlabs/workspace/nodoc",
          className: "icon--postman navbar--icon-link",
          "aria-label": "Postman collection",
          position: "right",
        },
        {
          href: "https://github.com/nathanmcnulty/nodoc",
          className: "icon--github navbar--icon-link",
          "aria-label": "GitHub repository",
          position: "right",
        }
      ],
    },
    footer: {
      logo: {
        alt: "dolphin labs logo",
        src: "./img/dolphin_labs_black.svg",
        srcDark: "./img/dolphin_labs_green.svg",
      },
      copyright: `Copyright © ${new Date().getFullYear()} Dolphin Labs Ltd.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
