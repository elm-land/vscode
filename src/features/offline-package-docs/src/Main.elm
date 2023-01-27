module Main exposing (main)

import Basics
import Block
import Browser
import Browser.Dom
import Documentation exposing (Documentation)
import Elm.Docs
import Elm.Version
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Json.Decode
import Markdown
import Task


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = subscriptions
        , view = view
        }



-- INIT


type alias Flags =
    { author : String
    , package : String
    , version : String
    , moduleName : String
    , elmLogoUrl : String
    , typeOrValueName : Maybe String
    , docs : Json.Decode.Value
    , readme : String
    }


type alias Model =
    { flags : Flags
    , docs : Maybe Documentation
    , selectedModule : Maybe Documentation.Module
    , search : String
    }


init : Flags -> ( Model, Cmd Msg )
init flags =
    let
        docs : Maybe Documentation
        docs =
            Documentation.fromJson flags.docs
    in
    ( { flags = flags
      , docs = docs
      , selectedModule =
            docs
                |> Maybe.andThen (Documentation.findModuleWithName flags.moduleName)
      , search = ""
      }
    , Cmd.none
    )



-- UPDATE


type Msg
    = UserChangedSearchInput String
    | UserClickedReadmeLink
    | UserSelectedModuleName String
    | BrowserScrolledToTop


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        BrowserScrolledToTop ->
            ( model, Cmd.none )

        UserChangedSearchInput value ->
            ( { model | search = value }
            , Cmd.none
            )

        UserClickedReadmeLink ->
            ( { model | selectedModule = Nothing }
            , scrollToTop
            )

        UserSelectedModuleName moduleName ->
            ( { model
                | selectedModule =
                    model.docs
                        |> Maybe.andThen (Documentation.findModuleWithName moduleName)
              }
            , scrollToTop
            )


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none



-- VIEW


css =
    """
@import url('https://fonts.googleapis.com/css2?family=Source+Sans+Pro:ital,wght@0,400;0,700;1,400;1,700&display=swap');

body {
    font-family: 'Source Sans Pro', sans-serif;
    padding: 0;
    padding-bottom: 4rem;
}

button {
    background: 0;
    border: 0;
    padding: 0;
    font: inherit;
    cursor: pointer;
}

input {
    font: inherit;
}

.link {
    color: var(--vscode-textLink-foreground);
    text-decoration: underline;
}

.link:hover {
    color: var(--vscode-textLink-activeForeground);
}

/* NAVBAR */

.navbar {
    display: flex;
    padding: 1rem 1.5rem;
    align-items: center;
    gap: 1rem;
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background);
}

.navbar > img {
    width: 32px;
    height: 32px;
}

.breadcrumbs {
    display: flex;
    align-items: center;
    font-size: 1.25em;
}

.breadcrumbs > *:not(:first-child)::before {
    content: '/';
    padding: 0 0.25em;
}


/* SIDEBAR */

.page {
    display: flex;
    align-items: flex-start;
    padding: 0 1.5rem;
}

.sidebar {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    position: sticky;
    top: 4rem;
    margin-left: 1em;
    z-index: 2;
}

.sidebar .links {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
}

hr {
    display: flex;
    border: 0;
    border-top: solid 1px;
}

.sidebar .form {
    position: relative;
}

.sidebar .form::before {
    content: '🔍';
    position: absolute;
    top: 50%;
    left: 0.75em;
    width: 1em;
    height: 1em;
    display: flex;
    transform: translateY(-50%);
    align-items: center;
    justify-content: center;
}

.sidebar input {
    border: solid 1px;
    padding: 0.75em 0.75em;
    font-size: 0.75em;
    padding-left: 3em;
}

.sidebar input::placeholder {
    color: inherit;
    opacity: 0.5;
    font: inherit;
}


/* MARKDOWN */

.column {
    display: flex;
    flex-direction: column;
    width: 30rem;
}

.column > pre,
.column > * > pre {
    overflow-x: auto;
    white-space: pre-wrap;
    line-height: 1.5;
}

.markdown {
    font-size: 0.85rem;
    width: 30rem;
    width: 30rem;
    line-height: 1.5;
}

.markdown *:first-child {
    margin-top: 1rem;
}

.markdown h1, .markdown h2, .markdown h3, .markdown h4 {
    margin-top: 1em;
}

.markdown blockquote {
    margin: 0;
    padding: 1px 1em;
    border-left: solid 3px;
    border-radius: 0.25em;
}

.markdown pre {
    border-radius: 0.25em;
    padding: 1em;
    overflow-x: auto;
    background: var(--vscode-welcomePage-tileBackground);
    box-shadow: 0 0.125em 0.75em var(--vscode-widget-shadow);
    border: solid 1px var(--vscode-widget-shadow);
}

.markdown code {
    font-family: var(--vscode-editor-font-family);
}

.docs-header {
    font-family: var(--vscode-editor-font-family);
    line-height: 1.5;
    white-space: pre-wrap;
    color: var(--vscode-textPreformat-foreground);
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: solid 1px;
}

.column .markdown h1,
.column .markdown h2 {
    margin-top: 2rem;
    margin-bottom: 0em;
}

.markdown pre code {
    color: inherit;
}
"""


view : Model -> Html Msg
view model =
    div [ class "layout" ]
        [ node "style" [] [ text css ]
        , header [ class "navbar" ]
            [ img [ src model.flags.elmLogoUrl, alt "Elm Logo" ] []
            , span [ class "breadcrumbs" ]
                [ span [] [ text model.flags.author ]
                , span [] [ text model.flags.package ]
                , span [] [ text model.flags.version ]
                ]
            ]
        , case model.docs of
            Just docs ->
                div [ class "page" ]
                    [ case model.selectedModule of
                        Nothing ->
                            Markdown.toHtml [ class "markdown" ]
                                model.flags.readme

                        Just module_ ->
                            div []
                                [ h1 [] [ text module_.name ]
                                , Elm.Docs.toBlocks module_
                                    |> List.map (viewBlock docs model)
                                    |> div [ class "column" ]
                                ]
                    , aside [ class "sidebar" ]
                        [ span [ class "links" ]
                            [ button
                                [ class "link"
                                , onClick UserClickedReadmeLink
                                ]
                                [ text "README" ]

                            -- , span [] [ text "About" ]
                            , a
                                [ class "link"
                                , href
                                    ("https://package.elm-lang.org/packages/$author/$package/$version"
                                        |> String.replace "$author" model.flags.author
                                        |> String.replace "$package" model.flags.package
                                        |> String.replace "$version" model.flags.version
                                    )
                                ]
                                [ text "Elm Package ↗" ]
                            , a
                                [ class "link"
                                , href
                                    ("https://github.com/$author/$package/tree/$version"
                                        |> String.replace "$author" model.flags.author
                                        |> String.replace "$package" model.flags.package
                                        |> String.replace "$version" model.flags.version
                                    )
                                ]
                                [ text "Source ↗" ]
                            ]
                        , h3 [ style "margin-bottom" "0" ] [ text "Modules" ]

                        -- , Html.div [ class "form" ]
                        --     [ input
                        --         [ type_ "search"
                        --         , value model.search
                        --         , placeholder "Search..."
                        --         , onInput UserChangedSearchInput
                        --         ]
                        --         []
                        --     ]
                        , span [ class "links" ]
                            (docs.modules
                                |> List.map .name
                                |> List.filter (isInSearchQuery model.search)
                                |> List.map viewModuleLink
                            )
                        ]
                    ]

            -- pre
            --     [ style "max-width" "100vw"
            --     , style "white-space" "pre-wrap"
            --     ]
            --     [
            -- code []
            -- [ text
            --     (docs.modules
            --         |> List.map Documentation.toListOfItems
            --         |> Debug.toString
            --     )
            -- ]
            -- ]
            Nothing ->
                text "Something went wrong..."
        ]


viewModuleLink : String -> Html Msg
viewModuleLink name =
    button
        [ class "link"
        , onClick (UserSelectedModuleName name)
        ]
        [ text name ]


isInSearchQuery : String -> String -> Bool
isInSearchQuery query name =
    String.contains
        (String.toLower query)
        (String.toLower name)


viewBlock : Documentation -> Model -> Elm.Docs.Block -> Html Msg
viewBlock docs model block =
    let
        info : Block.Info
        info =
            Block.makeInfo
                model.flags.author
                model.flags.package
                (Elm.Version.fromString model.flags.version)
                model.flags.moduleName
                docs.modules
    in
    Block.view info block


scrollToTop : Cmd Msg
scrollToTop =
    Task.perform
        (\_ -> BrowserScrolledToTop)
        (Browser.Dom.setViewport 0 0)
