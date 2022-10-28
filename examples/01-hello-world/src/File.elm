module File exposing (thing)


type File
    = File ()
    | NotAFile


thing : File
thing =
    File ()
