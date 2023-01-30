module Main exposing (main)

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
import Svg exposing (Svg)
import Svg.Attributes as Attr
import Task exposing (Task)


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
    , selectedDeclarationName : Maybe String
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
      , selectedDeclarationName = flags.typeOrValueName
      , search = ""
      }
    , case flags.typeOrValueName of
        Just id ->
            scrollToElementWithId id

        Nothing ->
            Cmd.none
    )



-- UPDATE


type Msg
    = UserChangedSearchInput String
    | UserClickedReadmeLink
    | UserSelectedModuleName String
    | UserSelectedModuleDeclaration String String
    | BrowserFinishedScrolling


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        BrowserFinishedScrolling ->
            ( model, Cmd.none )

        UserChangedSearchInput value ->
            ( { model | search = value }
            , Cmd.none
            )

        UserClickedReadmeLink ->
            ( { model | selectedModule = Nothing, selectedDeclarationName = Nothing }
            , scrollToTop
            )

        UserSelectedModuleName moduleName ->
            ( { model
                | search = ""
                , selectedModule =
                    model.docs
                        |> Maybe.andThen (Documentation.findModuleWithName moduleName)
                , selectedDeclarationName = Nothing
              }
            , scrollToTop
            )

        UserSelectedModuleDeclaration moduleName declarationName ->
            ( { model
                | search = ""
                , selectedModule =
                    model.docs
                        |> Maybe.andThen (Documentation.findModuleWithName moduleName)
                , selectedDeclarationName = Just declarationName
              }
            , scrollToElementWithId declarationName
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
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
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
    font-size: 10px;
    top: 50%;
    left: 6px;
    width: 1rem;
    height: 1rem;
    display: flex;
    transform: translateY(-50%);
    align-items: center;
    justify-content: center;
}

.sidebar input {
    border: solid 1px;
    padding: 0.75em 0.75em;
    font-size: 0.75em;
    padding-left: 26px;
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

.markdown a:not([href^=http]) {
    cursor: default;
    text-decoration: inherit;
    color: inherit;
}

.markdown a:not([href^=http]) code {
    color: var(--vscode-textPreformat-foreground);
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

/* Show flash animation when jumping to a definition */
.docs-block--flash {
    animation: flash 1200ms cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes flash {
    0% { background: var(--vscode-merge-incomingContentBackground); }
    100% { background: 0; }
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
                                [ span [] [ text "Elm Package" ]
                                , externalLinkIcon
                                ]
                            , a
                                [ class "link"
                                , href
                                    ("https://github.com/$author/$package/tree/$version"
                                        |> String.replace "$author" model.flags.author
                                        |> String.replace "$package" model.flags.package
                                        |> String.replace "$version" model.flags.version
                                    )
                                ]
                                [ span [] [ text "Source" ]
                                , externalLinkIcon
                                ]
                            ]
                        , h3 [ style "margin-bottom" "0" ] [ text "Modules" ]
                        , Html.div [ class "form" ]
                            [ input
                                [ type_ "search"
                                , value model.search
                                , placeholder "Search..."
                                , onInput UserChangedSearchInput
                                ]
                                []
                            ]
                        , span [ class "links" ]
                            (docs.modules
                                |> List.map toModuleAndFunctions
                                |> List.filterMap (toSearchResult model.search)
                                |> List.concatMap viewSearchResult
                            )
                        ]
                    ]

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


viewModuleDeclarationLink : String -> String -> Html Msg
viewModuleDeclarationLink moduleName declarationName =
    button
        [ class "link"
        , onClick (UserSelectedModuleDeclaration moduleName declarationName)
        ]
        [ text declarationName ]


viewSearchResult : SearchResult -> List (Html Msg)
viewSearchResult searchResult =
    [ viewModuleLink searchResult.name
    , if List.isEmpty searchResult.children then
        text ""

      else
        div [ class "links", style "padding-left" "1rem" ]
            (List.map (viewModuleDeclarationLink searchResult.name)
                searchResult.children
            )
    ]


type alias ModuleAndFunctions =
    { moduleName : String
    , declarationNames : List String
    }


toModuleAndFunctions : Documentation.Module -> ModuleAndFunctions
toModuleAndFunctions module_ =
    { moduleName = module_.name
    , declarationNames =
        List.concat
            [ List.map .name module_.aliases
            , List.map .name module_.binops
            , List.map .name module_.unions
            , List.map .name module_.values
            ]
    }


type alias SearchResult =
    { name : String
    , children : List String
    }


toSearchResult : String -> ModuleAndFunctions -> Maybe SearchResult
toSearchResult query { moduleName, declarationNames } =
    let
        children : List String
        children =
            List.filter (isMatch query) declarationNames
    in
    if String.isEmpty (String.trim query) then
        Just { name = moduleName, children = [] }

    else if List.length children > 0 || isMatch query moduleName then
        Just { name = moduleName, children = children }

    else
        Nothing


isMatch : String -> String -> Bool
isMatch query text =
    String.contains
        (String.toLower query)
        (String.toLower text)


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
                model.selectedDeclarationName
                docs.modules
    in
    Block.view info block


scrollToTop : Cmd Msg
scrollToTop =
    Task.perform
        (\_ -> BrowserFinishedScrolling)
        (Browser.Dom.setViewport 0 0)


scrollToElementWithId : String -> Cmd Msg
scrollToElementWithId id =
    let
        spaceToAccountForNavbar : Float
        spaceToAccountForNavbar =
            64

        setViewport : Browser.Dom.Element -> Task Browser.Dom.Error ()
        setViewport { element } =
            Browser.Dom.setViewport 0 (element.y - spaceToAccountForNavbar)
    in
    Browser.Dom.getElement id
        |> Task.andThen setViewport
        |> Task.attempt (\_ -> BrowserFinishedScrolling)


externalLinkIcon : Svg Msg
externalLinkIcon =
    Svg.svg
        [ Attr.viewBox "0 0 30 30"
        , Attr.width "1em"
        , Attr.height "1em"
        ]
        [ Svg.path
            [ Attr.fill "currentColor"
            , Attr.d "M 25.980469 2.9902344 A 1.0001 1.0001 0 0 0 25.869141 3 L 20 3 A 1.0001 1.0001 0 1 0 20 5 L 23.585938 5 L 13.292969 15.292969 A 1.0001 1.0001 0 1 0 14.707031 16.707031 L 25 6.4140625 L 25 10 A 1.0001 1.0001 0 1 0 27 10 L 27 4.1269531 A 1.0001 1.0001 0 0 0 25.980469 2.9902344 z M 6 7 C 4.9069372 7 4 7.9069372 4 9 L 4 24 C 4 25.093063 4.9069372 26 6 26 L 21 26 C 22.093063 26 23 25.093063 23 24 L 23 14 L 23 11.421875 L 21 13.421875 L 21 16 L 21 24 L 6 24 L 6 9 L 14 9 L 16 9 L 16.578125 9 L 18.578125 7 L 16 7 L 14 7 L 6 7 z"
            ]
            []
        ]
